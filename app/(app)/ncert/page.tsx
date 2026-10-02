import { BookOpen } from "lucide-react";
import { getClasses } from "@/services/ncert";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ClassPicker } from "@/components/curriculum/ClassPicker";
export default async function Ncert() {
  const classes = await getClasses();
  return (
    <div><PageHeader title="NCERT" subtitle="Pick a class to browse subjects, books and chapters." />
      {classes.length === 0
        ? <EmptyState icon={BookOpen} title="No NCERT classes yet" hint="Import the verified NCERT dataset to start browsing." actions={[{ href: "/admin/import", label: "Import Curriculum" }]} />
        : <ClassPicker grades={classes.map((c) => c.grade)} />}
    </div>
  );
}
