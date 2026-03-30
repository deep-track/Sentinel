"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { KYCRecord, KYCStatus } from "@/lib/kyc-types";
import { getDeclineBreakdown } from "@/lib/shufti-decline-codes";
import { cn } from "@/lib/utils";
import { KYCStatusBadge } from "@/modules/kyc/kyc-status-badge";
import {
	type ColumnDef,
	type SortingState,
	flexRender,
	getCoreRowModel,
	getFilteredRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	useReactTable,
} from "@tanstack/react-table";
import { format } from "date-fns";
import {
	ArrowUpDown,
	ChevronLeft,
	ChevronRight,
	Eye,
	Search,
	X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface KYCTableProps {
	records: KYCRecord[];
	isLoading?: boolean;
}

const STATUS_OPTIONS: { value: KYCStatus | "all"; label: string }[] = [
	{ value: "all", label: "All statuses" },
	{ value: "pending", label: "Pending" },
	{ value: "processing", label: "Processing" },
	{ value: "approved", label: "Approved" },
	{ value: "declined", label: "Declined" },
	{ value: "requires_review", label: "Needs Review" },
	{ value: "expired", label: "Expired" },
];

export function KYCTable({ records, isLoading }: KYCTableProps) {
	const router = useRouter();
	const [sorting, setSorting] = useState<SortingState>([]);
	const [globalFilter, setGlobalFilter] = useState("");
	const [statusFilter, setStatusFilter] = useState<string>("all");

	const filteredData = records.filter((r) => {
		if (statusFilter !== "all" && r.status !== statusFilter) return false;
		if (globalFilter) {
			const q = globalFilter.toLowerCase();
			return (
				r.userName?.toLowerCase().includes(q) ||
				r.userEmail?.toLowerCase().includes(q) ||
				r.reference?.toLowerCase().includes(q)
			);
		}
		return true;
	});

	const columns: ColumnDef<KYCRecord>[] = [
		{
			accessorKey: "userName",
			header: ({ column }) => (
				<button
					className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
					onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
				>
					Name <ArrowUpDown className="h-3 w-3" />
				</button>
			),
			cell: ({ row }) => (
				<div>
					<p className="font-medium text-slate-800 dark:text-slate-200 text-sm">
						{row.original.userName ||
							row.original.userEmail?.split("@")[0] ||
							"Unknown"}
					</p>
					<p className="text-xs text-slate-500 dark:text-slate-400">
						{row.original.userEmail ?? ""}
					</p>
				</div>
			),
		},
		{
			accessorKey: "reference",
			header: () => (
				<span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
					Reference
				</span>
			),
			cell: ({ getValue }) => (
				<code className="text-xs font-mono text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
					{String(getValue()).slice(0, 20)}…
				</code>
			),
		},
		{
			accessorKey: "documentType",
			header: () => (
				<span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
					Document
				</span>
			),
			cell: ({ getValue }) => {
				const labels: Record<string, string> = {
					passport: "Passport",
					id_card: "National ID",
					driving_license: "Driver's License",
				};
				return (
					<span className="text-sm text-slate-600 dark:text-slate-400">
						{labels[String(getValue())] ?? String(getValue())}
					</span>
				);
			},
		},
		{
			accessorKey: "status",
			header: () => (
				<span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
					Status
				</span>
			),
			cell: ({ row }) => {
				const record = row.original;
				let humanReason: string | null = null;

				if (record.status === "declined") {
					const breakdown = getDeclineBreakdown(
						record.declinedCodes as string[] | null,
						(record as any).servicesDeclinedCodes,
						record.declineReason,
					);
					humanReason = breakdown.humanReason;
				}

				return (
					<div className="flex flex-col gap-1">
						<KYCStatusBadge status={record.status as KYCStatus} size="sm" />
						{humanReason && (
							<p
								className="text-xs text-red-600 dark:text-red-400 max-w-xs truncate"
								title={humanReason}
							>
								{humanReason}
							</p>
						)}
					</div>
				);
			},
		},
		{
			accessorKey: "createdAt",
			header: ({ column }) => (
				<button
					className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
					onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
				>
					Submitted <ArrowUpDown className="h-3 w-3" />
				</button>
			),
			cell: ({ getValue }) => {
				const val = getValue();
				if (!val) return <span className="text-slate-400 text-xs">—</span>;
				return (
					<span className="text-sm text-slate-600 dark:text-slate-400">
						{format(new Date(String(val)), "MMM d, yyyy")}
					</span>
				);
			},
		},
		{
			id: "actions",
			cell: ({ row }) => (
				<button
					onClick={() => router.push(`/kyc/${row.original.id}`)}
					className="flex items-center gap-1.5 text-xs font-medium text-violet-600 dark:text-violet-400 hover:text-violet-800 dark:hover:text-violet-300 transition-colors"
				>
					<Eye className="h-3.5 w-3.5" /> View
				</button>
			),
		},
	];

	const table = useReactTable({
		data: filteredData,
		columns,
		state: { sorting },
		onSortingChange: setSorting,
		getCoreRowModel: getCoreRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
		getSortedRowModel: getSortedRowModel(),
		initialState: { pagination: { pageSize: 10 } },
	});

	return (
		<div className="space-y-4">
			<div className="flex flex-col sm:flex-row gap-3">
				<div className="relative flex-1 max-w-sm">
					<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
					<Input
						placeholder="Search name, email, reference…"
						value={globalFilter}
						onChange={(e) => setGlobalFilter(e.target.value)}
						className="pl-9 pr-8"
					/>
					{globalFilter && (
						<button
							onClick={() => setGlobalFilter("")}
							className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
						>
							<X className="h-3.5 w-3.5" />
						</button>
					)}
				</div>
				<Select value={statusFilter} onValueChange={setStatusFilter}>
					<SelectTrigger className="w-full sm:w-44">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{STATUS_OPTIONS.map((opt) => (
							<SelectItem key={opt.value} value={opt.value}>
								{opt.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			<div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
				<Table>
					<TableHeader>
						{table.getHeaderGroups().map((headerGroup) => (
							<TableRow
								key={headerGroup.id}
								className="bg-slate-50 dark:bg-slate-800/50"
							>
								{headerGroup.headers.map((header) => (
									<TableHead key={header.id} className="h-10">
										{flexRender(
											header.column.columnDef.header,
											header.getContext(),
										)}
									</TableHead>
								))}
							</TableRow>
						))}
					</TableHeader>
					<TableBody>
						{isLoading ? (
							Array.from({ length: 5 }).map((_, i) => (
								<TableRow key={i}>
									{columns.map((_, j) => (
										<TableCell key={j}>
											<div className="h-4 rounded bg-slate-100 dark:bg-slate-800 animate-pulse w-24" />
										</TableCell>
									))}
								</TableRow>
							))
						) : table.getRowModel().rows.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={columns.length}
									className="h-32 text-center"
								>
									<p className="text-slate-500 dark:text-slate-400 text-sm">
										No KYC records found
									</p>
								</TableCell>
							</TableRow>
						) : (
							table.getRowModel().rows.map((row) => (
								<TableRow
									key={row.id}
									className={cn(
										"cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors",
									)}
									onClick={() => router.push(`/kyc/${row.original.id}`)}
								>
									{row.getVisibleCells().map((cell) => (
										<TableCell key={cell.id}>
											{flexRender(
												cell.column.columnDef.cell,
												cell.getContext(),
											)}
										</TableCell>
									))}
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			<div className="flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
				<p>
					Showing{" "}
					{table.getState().pagination.pageIndex *
						table.getState().pagination.pageSize +
						1}
					–
					{Math.min(
						(table.getState().pagination.pageIndex + 1) *
							table.getState().pagination.pageSize,
						filteredData.length,
					)}{" "}
					of {filteredData.length} records
				</p>
				<div className="flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={() => table.previousPage()}
						disabled={!table.getCanPreviousPage()}
					>
						<ChevronLeft className="h-4 w-4" />
					</Button>
					<span className="text-sm px-2">
						Page {table.getState().pagination.pageIndex + 1} of{" "}
						{table.getPageCount()}
					</span>
					<Button
						variant="outline"
						size="sm"
						onClick={() => table.nextPage()}
						disabled={!table.getCanNextPage()}
					>
						<ChevronRight className="h-4 w-4" />
					</Button>
				</div>
			</div>
		</div>
	);
}
