// netlify/functions/speech-to-text-sync.js
//
// Fonction Netlify CLASSIQUE (synchrone, limitée à 10-26 secondes
// d'exécution — largement suffisant pour transcrire un audio court via
// Groq Whisper, qui répond généralement en quelques secondes).
//
// Utilisée pour les enregistrements COURTS (tous les exercices structurés
// et le défi du jour, jusqu'à ~180 secondes de discours) — voir le
// branchement dans transcribeAndAnalyze() côté client (index.html). Pour
// ces cas, le circuit Storage + fonction background + Firestore (voir
// speech-to-text-background.js) est une lourdeur inutile, uniquement
// nécessaire pour contourner la limite de durée d'exécution sur un DISCOURS
// LONG (Discours Libre, jusqu'à 900s) — cette fonction-ci l'évite
// entièrement pour la grande majorité des exercices : le client envoie
// l'audio directement en base64 dans le corps JSON de la requête (limite
// Netlify d'environ 6 Mo par requête, largement suffisante pour un
// enregistrement de quelques dizaines de secondes à ~3 minutes) et reçoit
// le texte transcrit directement dans la réponse HTTP.
//
// Contrairement à speech-to-text-background.js, cette fonction ne touche
// jamais à Firebase Storage ni à Firestore : l'audio reste uniquement en
// mémoire le temps de l'appel à Groq, jamais écrit sur disque ni conservé
// nulle part — conformément à la politique de confidentialité d'Awa.

exports.handler = async (event) => {
  try {
    console.log('speech-to-text-sync: invocation reçue');

    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const body = JSON.parse(event.body || '{}');
    const audioBase64 = body.audioBase64;
    const mimeType = body.mimeType || 'audio/webm';

    if (!audioBase64) {
      console.error('speech-to-text-sync: audioBase64 manquant');
      return { statusCode: 400, body: JSON.stringify({ error: 'audioBase64 requis' }) };
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error('GROQ_API_KEY non configurée côté serveur');
    }

    const audioBuffer = Buffer.from(audioBase64, 'base64');
    console.log('speech-to-text-sync: audio décodé, taille =', audioBuffer.length, 'octets');

    // Même construction manuelle de multipart/form-data que
    // speech-to-text-background.js, pour rester cohérent avec l'appel Groq.
    const extension = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('aac') ? 'aac' : 'webm';
    const boundary = '----voixafriqueBoundary' + Date.now();

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

    console.log('speech-to-text-sync: réponse Groq reçue, statut =', response.status);

    if (!response.ok) {
      const errText = await response.text().catch(() => '(corps illisible)');
      throw new Error(`Erreur Groq: ${errText.slice(0, 300)}`);
    }

    const data = await response.json();
    console.log('speech-to-text-sync: transcription reçue, longueur texte =', (data.text || '').length);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: data.text || '' })
    };

  } catch (err) {
    console.error('speech-to-text-sync: ERREUR', err && err.stack ? err.stack : err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: (err && err.message) || String(err) })
    };
  }
};
