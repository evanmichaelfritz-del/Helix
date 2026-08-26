import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { connectDb } from "./db.ts";

const db = await connectDb();
const app = createApp(db);
const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, () => {
  console.log(`Helix API http://127.0.0.1:${port}`);
});
