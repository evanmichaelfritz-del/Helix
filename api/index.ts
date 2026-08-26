import { handle } from "hono/vercel";
import { createApp } from "../server/app.js";
import { connectDb } from "../server/db.js";

const db = await connectDb();
const app = createApp(db);

export const config = {
  runtime: "nodejs",
  maxDuration: 10,
};

export default handle(app);
