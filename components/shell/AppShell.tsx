import { Sidebar } from "./Sidebar";
import { BottomNav } from "./BottomNav";
import { AddSheet } from "./AddSheet";
import { MobileBar } from "./MobileBar";
import { CommandPalette } from "@/components/search/CommandPalette";
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <Sidebar />
      <MobileBar />
      {/* The fixed 16rem sidebar is reserved by padding on a full-width wrapper, so <main> is centred inside the REMAINING width.
          (Run #6: `w-full` + `lg:ml-64` made <main> 100% + 256px wide -> 256px horizontal overflow on every desktop route.) */}
      <div className="w-full lg:pl-64">
        <main className="mx-auto w-full max-w-5xl px-4 pb-32 pt-6 lg:px-10 lg:pb-16">{children}</main>
      </div>
      <AddSheet />
      <CommandPalette />
      <BottomNav />
    </div>
  );
}
