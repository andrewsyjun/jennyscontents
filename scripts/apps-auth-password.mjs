import crypto from "node:crypto";

const password = process.argv.slice(2).join(" ");

if (!password) {
  console.error("Usage: npm run apps:hash-password -- <password>");
  process.exit(1);
}

const iterations = 310_000;
const salt = crypto.randomBytes(18).toString("base64url");
const hash = crypto
  .pbkdf2Sync(password, salt, iterations, 32, "sha256")
  .toString("base64url");

console.log(`pbkdf2-sha256$${iterations}$${salt}$${hash}`);
