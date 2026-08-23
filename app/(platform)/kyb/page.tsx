export const dynamic = "force-dynamic";
import { Button } from "@/components/ui/button";
import { KYBTable } from "@/modules/kyb/kyb-table";
import {
	Building2,
	CheckCircle,
	FileCheck,
	ShieldAlert,
} from "lucide-react";
import Link from "next/link";

// NOTE: getKYBList and getKYBStats previously came from actions/kyb.ts,
// which was removed as part of the Convex backend migration. There is no
// public Convex query yet for listing or getting stats on KYB records
// (confirmed: convex/kyb.ts is currently empty). This page shows an
// honest empty state until those queries exist.

function StatCard({
	label,
	value,
	icon: Icon,
	tone,
}: {
	label: string;
	value: number;
	icon: React.ElementType;
	tone: "slate" | "violet" | "green" | "red" | "orange";
}) {
	const toneClass: Record<string, string> = {
		slate: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
		violet:
			"bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400",
		green:
			"bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400",
		red: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
		orange:
			"bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400",
	};

	return (
		<div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
			<div className="flex items-center justify-between">
				<p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
				<div
					className={`h-8 w-8 rounded-lg flex items-center justify-center ${toneClass[tone]}`}
				>
					<Icon className="h-4 w-4" />
				</div>
			</div>
			<p className="mt-3 text-2xl font-bold text-slate-900 dark:text-white">
				{value}
			</p>
		</div>
	);
}

export default async function KYBPage() {
	const records: import("@/backend/lib/types/kyb").KYBRecord[] = [];
	const stats = {
		total: 0,
		approved: 0,
		declined: 0,
		pending: 0,
		processing: 0,
		requires_review: 0,
	};

	return (
		<div className="min-h-full bg-slate-50 dark:bg-slate-950 py-8 px-4 sm:px-6">
			<div className="max-w-7xl mx-auto space-y-6">
				<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
					<div>
						<h1 className="text-2xl font-bold text-slate-900 dark:text-white">
							Know Your Business
						</h1>
						<p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
							Manage your business verification records
						</p>
					</div>
					<Button
						asChild
						className="bg-violet-600 hover:bg-violet-700 text-white"
					>
						<Link href="/kyb/new">
							<FileCheck className="mr-2 h-4 w-4" />
							New Verification
						</Link>
					</Button>
				</div>

				<div className="rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/20 p-4 text-sm text-amber-800 dark:text-amber-300">
					KYB records and stats are temporarily unavailable while the backend
					migrates to Convex.
				</div>

				<div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
					<StatCard
						label="Total"
						value={stats.total}
						icon={FileCheck}
						tone="slate"
					/>
					<StatCard
						label="Approved"
						value={stats.approved}
						icon={CheckCircle}
						tone="green"
					/>
					<StatCard
						label="Processing"
						value={stats.pending + stats.processing}
						icon={Building2}
						tone="violet"
					/>
					<StatCard
						label="Review"
						value={stats.requires_review}
						icon={ShieldAlert}
						tone="orange"
					/>
					<StatCard
						label="Declined"
						value={stats.declined}
						icon={CheckCircle}
						tone="red"
					/>
				</div>

				<div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 sm:p-6">
					<KYBTable records={records} />
				</div>
			</div>
		</div>
	);
}