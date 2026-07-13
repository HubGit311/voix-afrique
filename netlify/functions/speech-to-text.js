// netlify/functions/speech-to-text.js
//
// Transcrit un enregistrement audio via l'API Whisper d'OpenAI. La clé API
// reste côté serveur, jamais exposée au navigateur.
//
// Format simplifié (response_format=json, sans segmentation par pauses) :
// plus rapide que verbose_json + timestamp_granularities, au prix de la
// mesure fine des pauses/hésitations dans l'analyse de fluidité.

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { audioBase64, mimeType } = JSON.parse(event.body);

    if (!audioBase64) {
      return { statusCode: 400, body: JSON.stringify({ error: "audioBase64 manquant" }) };
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: "OPENAI_API_KEY non configurée côté serveur" }) };
    }

    // Reconstruction du fichier audio binaire à partir du base64
    const audioBuffer = Buffer.from(audioBase64, "base64");

    // Construction manuelle d'un multipart/form-data (pas de dépendance externe nécessaire)
    const boundary = "----voixafriqueBoundary" + Date.now();
    const extension = (mimeType && mimeType.includes("mp4")) ? "mp4" : "webm";

    const parts = [];
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n`
    ));
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nfr\r\n`
    ));
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\njson\r\n`
    ));
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.${extension}"\r\nContent-Type: ${mimeType || "audio/webm"}\r\n\r\n`
    ));
    parts.push(audioBuffer);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

    const body = Buffer.concat(parts);

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`
      },
      body
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "(corps illisible)");
      return { statusCode: response.status, body: JSON.stringify({ error: `Erreur OpenAI: ${errText.slice(0, 300)}` }) };
    }

    const data = await response.json();

    return {
      statusCode: 200,
      body: JSON.stringify({ text: data.text || "" })
    };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || String(err) }) };
  }
};
