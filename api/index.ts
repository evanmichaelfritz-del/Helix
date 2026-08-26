import { handle } from "hono/vercel";
import { createApp } from "./app.ts";
import { connectDb } from "./db.ts";

const db = await connectDb();
const app = createApp(db);

export const config = {
  runtime: "nodejs",
  maxDuration: 10,
};

export default handle(app);
