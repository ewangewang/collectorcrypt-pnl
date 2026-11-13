import { Suspense } from "react"
import { Dashboard } from "@/components/dashboard"
import { Skeleton } from "@/components/ui/skeleton"

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-6xl px-4 py-12">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="mt-4 h-24 w-full" />
        </div>
      }
    >
      <Dashboard />
    </Suspense>
  )
}
