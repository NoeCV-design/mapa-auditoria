import "dotenv/config";

async function main() {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    console.error("GOOGLE_AI_API_KEY no está definida en .env");
    process.exit(1);
  }

  for (const version of ["v1", "v1beta"]) {
    console.log(`\n=== Modelos disponibles en ${version} ===`);
    const res = await fetch(`https://generativelanguage.googleapis.com/${version}/models?key=${apiKey}`);
    const data = await res.json() as { models?: { name: string; supportedGenerationMethods?: string[] }[]; error?: { message: string } };

    if (data.error) {
      console.error(`  Error: ${data.error.message}`);
      continue;
    }

    const usable = (data.models ?? []).filter((m) => m.supportedGenerationMethods?.includes("generateContent"));
    for (const m of usable) {
      console.log(`  ${m.name}`);
    }
    if (usable.length === 0) console.log("  (ninguno)");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
