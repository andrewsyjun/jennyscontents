import { hashPassword } from "./apps-auth-db.mjs";

const password = process.argv.slice(2).join(" ");

if (!password) {
  console.error("Usage: npm run apps:hash-password -- <password>");
  process.exit(1);
}

console.log(hashPassword(password));
