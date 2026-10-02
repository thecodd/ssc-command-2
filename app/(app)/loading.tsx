import { Skeleton } from "@/components/ui/Skeleton";
export default function Loading() {
  return <div className="space-y-4" aria-busy="true" aria-label="Loading"><Skeleton className="h-9 w-2/3" /><Skeleton className="h-12" /><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div>;
}
