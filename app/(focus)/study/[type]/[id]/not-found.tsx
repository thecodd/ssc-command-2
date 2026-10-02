import Link from "next/link";
export default function StudyNotFound() {
  return (
    <div className="mx-auto max-w-md px-6 py-24 text-center">
      <h1 className="text-xl font-semibold">Nothing to study here</h1>
      <p className="mt-2 text-sm text-sub">That item doesn&apos;t exist, was archived, or isn&apos;t published yet. Study Mode works for NCERT chapters, SSC topics and SSC subtopics.</p>
      <div className="mt-6 flex justify-center gap-2"><Link href="/syllabus" className="btn-primary">Open the syllabus</Link><Link href="/dashboard" className="btn-ghost">Dashboard</Link></div>
    </div>
  );
}
