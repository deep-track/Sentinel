export const dynamic = "force-dynamic";

import { KYBWizard } from "@/modules/kyb/kyb-wizard";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { requireActiveScope } from "@/app/(platform)/_lib/active-client";

export default async function NewKYBPage() {
	const { scope } = await requireActiveScope();

	return (
		<div className="min-h-full bg-slate-50 dark:bg-slate-950 py-8 px-4 sm:px-6">
			<div className="max-w-3xl mx-auto">
				<Link
					href="/kyb"
					className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 mb-8 transition-colors"
				>
					<ChevronLeft className="h-4 w-4" /> Back to KYB
				</Link>

				<div className="mb-8">
					<h1 className="text-2xl font-bold text-slate-900 dark:text-white">
						Business Verification
					</h1>
					<p className="text-slate-500 dark:text-slate-400 mt-1 text-sm max-w-xl">
						Complete the steps below to verify a business for {scope.clientName}.
						Data is secured and processed through our verification partner.
					</p>
				</div>

				<KYBWizard clientId={scope.clientId} />
			</div>
		</div>
	);
}
