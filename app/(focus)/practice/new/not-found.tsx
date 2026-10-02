import Link from "next/link";
export default function PracticeNotFound() {
  return <div className="mx-auto max-w-md px-6 py-24 text-center"><h1 className="text-xl font-semibold">Practice session not found</h1><p className="mt-2 text-sm text-sub">It doesn&apos;t exist or belongs to another account.</p><Link href="/study" className="btn-primary mt-6">Back to Study</Link></div>;
}
