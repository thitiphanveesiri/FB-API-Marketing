// Sets the sign-in name + password for ONE user straight in the data store. Use it once to create the first Administrator
// (after that, Administrators set passwords in Settings → Users). Creates the user as Administrator if the id is new.
//   PASSWORD='long secret' npx tsx --env-file=.env.local scripts/set-password.ts <user_id> <username> [display name]
import { hashPassword, PASSWORD_MIN, usernameOk } from "../src/lib/auth";
import { upsertRows } from "../src/lib/sheetsWrite";
import { readTabs } from "../src/lib/googleSheets";

const [userId, rawUser, ...nameParts] = process.argv.slice(2);
const username = (rawUser ?? "").toLowerCase(), password = process.env.PASSWORD ?? "";
if (!userId || !usernameOk(username) || password.length < PASSWORD_MIN) {
  console.error("Usage: PASSWORD='min 8 chars' npx tsx --env-file=.env.local scripts/set-password.ts <user_id> <username a-z0-9._-> [name]");
  process.exit(1);
}
const grid = (await readTabs(true)).users ?? [];
const head = (grid[0] ?? []).map((h) => String(h).trim().toLowerCase());
const exists = grid.slice(1).some((r) => String(r[head.indexOf("user_id")] ?? "").trim() === userId);
const row = { user_id: userId, username, password_hash: await hashPassword(password),
  ...(exists ? {} : { name: nameParts.join(" ") || username, role: "Administrator", active: true }) };
await upsertRows("users", ["user_id"], [row], "upsert");
console.log(`${exists ? "Updated" : "Created Administrator"} ${userId}: sign in as "${username}".`);
