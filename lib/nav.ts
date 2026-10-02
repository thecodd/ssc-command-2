import { Home, Layers, Timer, RefreshCw, Menu, StickyNote, Target, BarChart3, BookOpen, GraduationCap, Link2, Settings, type LucideIcon } from "lucide-react";
export interface NavItem { href: string; label: string; icon: LucideIcon }
export const mobileNav: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/syllabus", label: "Syllabus", icon: Layers },
  { href: "/study", label: "Study", icon: Timer },
  { href: "/revision", label: "Revision", icon: RefreshCw },
  { href: "/more", label: "More", icon: Menu },
];
export const sidebarNav: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: Home },
  { href: "/syllabus", label: "Master Syllabus", icon: Layers },
  { href: "/ncert", label: "NCERT", icon: BookOpen },
  { href: "/ssc", label: "SSC CGL", icon: GraduationCap },
  { href: "/mapping", label: "Mapping", icon: Link2 },
  { href: "/study", label: "My Study", icon: Timer },
  { href: "/revision", label: "Revision", icon: RefreshCw },
  { href: "/pyqs", label: "PYQs", icon: Target },
  { href: "/notes", label: "Notes", icon: StickyNote },
  { href: "/resources", label: "Resources", icon: Link2 },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];
export const addActions = [
  { href: "/tasks/new", label: "Study task" },
  { href: "/syllabus/new", label: "Topic" },
  { href: "/notes/new", label: "Note" },
  { href: "/resources/new", label: "Resource" },
  { href: "/pyqs/new", label: "PYQ" },
];
