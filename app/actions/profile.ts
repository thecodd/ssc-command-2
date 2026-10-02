"use server";
import { revalidatePath } from "next/cache";
import { safe } from "@/lib/actions";
import { updateTimezone } from "@/services/profile";
export async function setTimezoneAction(tz: string) {
  return safe(async () => { await updateTimezone(tz); revalidatePath("/", "layout"); });
}
