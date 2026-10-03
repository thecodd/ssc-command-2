import { notFound } from "next/navigation";
// Every navigation target has a real screen; any other path is a genuine 404 (app/not-found.tsx).
export default function Unknown() { notFound(); }
