import { handle } from "hono/vercel";
import { createApp } from "../server/app.js";
import { connectDb } from "../server/db.js";

const db = await connectDb();
const app = createApp(db);

export const config = {
  runtime: "nodejs",
  maxDuration: 10,
};

// Node treats a default-export function as (req, res) => void and ignores a returned Response.
const handler = handle(app);
export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
