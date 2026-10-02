import { Hammer } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
export default function Pending({ params }: { params: { slug: string[] } }) {
  return <EmptyState icon={Hammer} title={`/${params.slug.join("/")} isn't built yet`} hint="This module lands in an upcoming build step." action={{ href: "/dashboard", label: "Back to Home" }} />;
}
