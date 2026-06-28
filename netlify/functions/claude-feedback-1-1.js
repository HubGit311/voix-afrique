// netlify/functions/claude-feedback.js
//
// Cette fonction s'exécute sur les serveurs de Netlify (jamais dans le navigateur).
// Elle reçoit le prompt depuis l'app, appelle l'API Anthropic avec la clé secrète
// (stockée en variable d'environnement, jamais visible publiquement),
// puis renvoie la réponse à l'app.

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

  const { prompt } = body;
  if (!prompt || typeof prompt !== "string") {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Le champ 'prompt' est requis." }),
    };
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
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
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
