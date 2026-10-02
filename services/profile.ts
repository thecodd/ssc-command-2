import { getUser, requireUser } from "@/lib/auth";
import { cache } from "@/lib/cache";
import { DEFAULT_TZ, addDaysISO, isValidTimeZone, todayIn } from "@/lib/time";

export interface Clock { tz: string; today: string; yesterday: string }
/** The one place that answers "what is today for this user?". Falls back to the default zone if the profile can't be read. */
export const getClock = cache(async (): Promise<Clock> => {
  let tz = DEFAULT_TZ;
  try {
    const { sb, user } = await getUser();
    if (user) {
      const { data } = await sb.from("profiles").select("timezone").eq("id", user.id).maybeSingle();
      if (data?.timezone && isValidTimeZone(data.timezone)) tz = data.timezone;
    }
  } catch { /* no session or no database: use the default zone */ }
  const today = todayIn(tz);
  return { tz, today, yesterday: addDaysISO(today, -1) };
});

export async function updateTimezone(tz: string) {
  if (!isValidTimeZone(tz)) throw new Error("Unknown time zone.");
  const { sb, user } = await requireUser();
  const { error } = await sb.from("profiles").update({ timezone: tz }).eq("id", user.id);
  if (error) throw new Error(error.message);
}
