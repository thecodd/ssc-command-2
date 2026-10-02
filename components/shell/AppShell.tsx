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
      <main className="mx-auto w-full max-w-5xl px-4 pb-32 pt-6 lg:ml-64 lg:px-10 lg:pb-16">{children}</main>
      <AddSheet />
      <CommandPalette />
      <BottomNav />
    </div>
  );
}
