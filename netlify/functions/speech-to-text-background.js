// netlify/functions/speech-to-text-background.js
//
// Fonction "Background" Netlify : contrairement à une fonction classique
// (limitée à 10-26 secondes), celle-ci dispose de jusqu'à 15 minutes
// d'exécution — nécessaire pour transcrire de longs discours (Toastmasters :
// 5 à 10+ minutes). Le fichier DOIT se terminer par "-background.js" pour
// que Netlify la traite comme telle.
//
// Le client déclenche cette fonction puis n'attend pas sa réponse HTTP
// (ignorée par Netlify) : il écoute à la place le document Firestore
// `transcriptions/{jobId}` dans lequel cette fonction écrit le résultat.
//
// Étapes : récupère l'audio déjà uploadé sur Firebase Storage par le client
// → le transcrit via Groq (Whisper) → écrit le texte dans Firestore →
// supprime l'audio de Storage (jamais conservé, conformément à la politique
// de confidentialité d'Awa).
//
// NOTE : on utilise volontairement l'API MODULAIRE de firebase-admin
// (require('firebase-admin/app'), etc.) plutôt que l'espace de noms global
// (require('firebase-admin')). L'espace de noms global s'est révélé
// incompatible avec le bundling esbuild de Netlify (admin.apps était
// undefined à l'exécution) — l'API modulaire, recommandée depuis
// firebase-admin v12+, n'a pas ce problème.

const { initializeApp, cert, getApps, getApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');

function getAdminApp() {
  if (getApps().length) return getApp();

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  // Les retours à la ligne sont échappés (\n) dans la variable d'environnement
  // Netlify — il faut les reconvertir en vrais retours à la ligne.
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  console.log('speech-to-text-background: vérification des variables d\'environnement', {
    hasProjectId: !!projectId,
    hasClientEmail: !!clientEmail,
    privateKeyLength: privateKey.length,
    privateKeyStartsCorrectly: privateKey.startsWith('-----BEGIN PRIVATE KEY-----')
  });

  return initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
    storageBucket: 'voix-afrique.firebasestorage.app'
  });
}

exports.handler = async (event) => {
  let jobId = null;
  let db = null;
  let storagePath = null;

  try {
    console.log('speech-to-text-background: invocation reçue');

    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const body = JSON.parse(event.body || '{}');
    jobId = body.jobId;
    storagePath = body.storagePath;
    const mimeType = body.mimeType || 'audio/webm';

    console.log('speech-to-text-background: params reçus', { jobId, storagePath, mimeType });

    if (!jobId || !storagePath) {
      console.error('speech-to-text-background: jobId ou storagePath manquant');
      return { statusCode: 400, body: JSON.stringify({ error: 'jobId et storagePath requis' }) };
    }

    console.log('speech-to-text-background: initialisation Firebase Admin…');
    const app = getAdminApp();
    console.log('speech-to-text-background: Firebase Admin initialisé OK');
    db = getFirestore(app);
    const bucket = getStorage(app).bucket();

    // Marque la tâche comme prise en charge (permet aussi au client de savoir
    // que l'upload + le déclenchement ont bien été reçus côté serveur)
    console.log('speech-to-text-background: écriture du statut pending dans Firestore…');
    await db.collection('transcriptions').doc(jobId).set({
      status: 'pending',
      startedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    console.log('speech-to-text-background: statut pending écrit OK');

    // 1. Récupère l'audio depuis Storage
    console.log('speech-to-text-background: téléchargement de l\'audio depuis Storage…');
    const file = bucket.file(storagePath);
    const [audioBuffer] = await file.download();
    console.log('speech-to-text-background: audio téléchargé OK, taille =', audioBuffer.length, 'octets');

    // 2. Construction manuelle d'un multipart/form-data pour Groq (identique
    // à l'ancienne fonction speech-to-text.js, juste la source de l'audio change)
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error('GROQ_API_KEY non configurée côté serveur');
    }

    const boundary = '----voixafriqueBoundary' + Date.now();
    const extension = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('aac') ? 'aac' : 'webm';

    const parts = [];
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3-turbo\r\n`
    ));
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nfr\r\n`
    ));
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\njson\r\n`
    ));
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.${extension}"\r\nContent-Type: ${mimeType}\r\n\r\n`
    ));
    parts.push(audioBuffer);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

    const requestBody = Buffer.concat(parts);

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body: requestBody
    });

    console.log('speech-to-text-background: réponse Groq reçue, statut =', response.status);

    if (!response.ok) {
      const errText = await response.text().catch(() => '(corps illisible)');
      throw new Error(`Erreur Groq: ${errText.slice(0, 300)}`);
    }

    const data = await response.json();
    console.log('speech-to-text-background: transcription reçue, longueur texte =', (data.text || '').length);

    // 3. Écrit le résultat dans Firestore — le client écoute ce document
    await db.collection('transcriptions').doc(jobId).set({
      status: 'done',
      text: data.text || '',
      completedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    console.log('speech-to-text-background: résultat écrit dans Firestore, terminé OK');

    return { statusCode: 200, body: 'ok' };

  } catch (err) {
    console.error('speech-to-text-background: ERREUR', err && err.stack ? err.stack : err);
    // En cas d'erreur, on prévient le client via Firestore plutôt que de le
    // laisser attendre indéfiniment un résultat qui ne viendra jamais.
    if (jobId && db) {
      await db.collection('transcriptions').doc(jobId).set({
        status: 'error',
        error: (err && err.message) || String(err),
        completedAt: FieldValue.serverTimestamp()
      }, { merge: true }).catch((writeErr) => {
        console.error('speech-to-text-background: échec de l\'écriture du statut error dans Firestore', writeErr);
      });
    }
    return { statusCode: 200, body: 'error handled' };

  } finally {
    // Nettoyage systématique : l'audio n'est jamais conservé, qu'il y ait eu
    // succès ou échec — conformément à la politique de confidentialité d'Awa.
    if (storagePath) {
      try {
        if (getApps().length) {
          const app = getApp();
          await getStorage(app).bucket().file(storagePath).delete().catch((delErr) => {
            console.error('speech-to-text-background: échec suppression audio Storage', delErr);
          });
          console.log('speech-to-text-background: audio supprimé de Storage (nettoyage)');
        }
      } catch (_) { /* pas grave si le nettoyage échoue, sans impact utilisateur */ }
    }
  }
};
