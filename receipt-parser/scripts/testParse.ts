import * as fs from "fs";
import * as path from "path";
import FormData = require("form-data");
import fetch from "node-fetch";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

async function main() {
  const imagePath = process.argv[2];
  if (!imagePath) {
    console.error("Usage: npx ts-node scripts/testParse.ts <path-to-image>");
    process.exit(1);
  }

  const absolutePath = path.resolve(imagePath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`File not found: ${absolutePath}`);
    process.exit(1);
  }

  const form = new FormData();
  form.append("image", fs.createReadStream(absolutePath), {
    filename: path.basename(absolutePath),
    contentType: "image/jpeg",
  });

  console.log(`Sending ${absolutePath} to ${BASE_URL}/api/parse ...`);

  const res = await fetch(`${BASE_URL}/api/parse`, {
    method: "POST",
    body: form as unknown as import("node-fetch").BodyInit,
    headers: form.getHeaders(),
  });

  const json = await res.json();
  console.log(`\nHTTP ${res.status}\n`);
  console.log(JSON.stringify(json, null, 2));

  if (!res.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
