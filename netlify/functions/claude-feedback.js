// netlify/functions/claude-feedback.js
//
// Cette fonction s'exécute sur les serveurs de Netlify (jamais dans le navigateur).
// Elle reçoit le prompt (et, optionnellement, des images pour l'analyse de
// gestuelle/posture) depuis l'app, appelle l'API Anthropic avec la clé secrète
// (stockée en variable d'environnement, jamais visible publiquement),
// puis renvoie la réponse à l'app.
//
// Modèle Haiku (rapide) plutôt que Sonnet : pour ce feedback structuré et bien
// cadré, la vitesse compte plus que le raisonnement le plus poussé possible.
// Haiku 4.5 comprend aussi les images, donc reste utilisé même pour l'analyse
// vidéo (frames) — à réévaluer si la qualité du retour posture/gestuelle
// s'avère insuffisante en pratique.

exports.handler = async function (event) {
  // On n'accepte que les requêtes POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Méthode non autorisée. Utilisez POST." }),
    };
  }

  // La clé API est lue depuis les variables d'environnement Netlify (jamais exposée au client)
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Clé API non configurée sur le serveur Netlify." }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Corps de requête JSON invalide." }),
    };
  }

  const { prompt, images } = body;
  if (!prompt || typeof prompt !== "string") {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Le champ 'prompt' est requis." }),
    };
  }

  // `images` est optionnel : tableau de data URLs base64 (ex: "data:image/jpeg;base64,...").
  // Utilisé uniquement pour l'analyse de posture/gestuelle à partir des frames
  // vidéo capturées côté client — jamais de vidéo complète envoyée.
  let content = prompt;
  if (Array.isArray(images) && images.length > 0) {
    const MAX_IMAGES = 15; // garde-fou côté serveur, en plus du plafond déjà côté client
    const imageBlocks = [];
    for (const dataUrl of images.slice(0, MAX_IMAGES)) {
      if (typeof dataUrl !== "string") continue;
      const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
      if (!match) continue; // on ignore silencieusement tout format inattendu/malformé
      imageBlocks.push({
        type: "image",
        source: { type: "base64", media_type: match[1], data: match[2] },
      });
    }
    if (imageBlocks.length > 0) {
      content = [...imageBlocks, { type: "text", text: prompt }];
    }
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1000,
        messages: [{ role: "user", content }],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: data.error?.message || "Erreur API Anthropic", details: data }),
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: "Échec de l'appel à l'API Anthropic : " + err.message }),
    };
  }
};
