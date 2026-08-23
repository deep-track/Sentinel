"use client";

import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type ColumnDef,
  type SortingState,
  flexRender,
} from "@tanstack/react-table";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { KYIRecord, KYIStatus } from "@/backend/lib/kyi-types";
import { KYIStatusBadge } from "@/modules/kyi/kyi-status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowUpDown, ChevronLeft, ChevronRight, Eye, Search, X } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/backend/lib/utils";

interface KYITableProps {
  records: KYIRecord[];
  isLoading?: boolean;
}

const STATUS_OPTIONS: { value: KYIStatus | "all"; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "processing", label: "Processing" },
  { value: "approved", label: "Approved" },
  { value: "declined", label: "Declined" },
  { value: "requires_review", label: "Needs Review" },
  { value: "expired", label: "Expired" },
];

const INVESTOR_TYPE_OPTIONS = [
  { value: "all", label: "All investor types" },
  { value: "individual", label: "Individual" },
  { value: "joint", label: "Joint" },
  { value: "corporate", label: "Corporate" },
  { value: "fund", label: "Fund" },
  { value: "trust", label: "Trust" },
  { value: "pension_fund", label: "Pension Fund" },
  { value: "family_office", label: "Family Office" },
];

export function KYITable({ records, isLoading }: KYITableProps) {
  const router = useRouter();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [investorTypeFilter, setInvestorTypeFilter] = useState<string>("all");

  const filteredData = records.filter((record) => {
    if (statusFilter !== "all" && record.status !== statusFilter) return false;
    if (investorTypeFilter !== "all" && record.investorType !== investorTypeFilter) return false;

    if (globalFilter) {
      const query = globalFilter.toLowerCase();
      return (
        record.userName?.toLowerCase().includes(query) ||
        record.userEmail?.toLowerCase().includes(query) ||
        record.reference?.toLowerCase().includes(query)
      );
    }

    return true;
  });

  const columns: ColumnDef<KYIRecord>[] = [
    {
      accessorKey: "userName",
      header: ({ column }) => (
        <button
          className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Investor <ArrowUpDown className="h-3 w-3" />
        </button>
      ),
      cell: ({ row }) => (
        <div>
          <p className="font-medium text-slate-800 dark:text-slate-200 text-sm">{row.original.userName}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{row.original.userEmail}</p>
        </div>
      ),
    },
    {
      accessorKey: "investorType",
      header: () => (
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Investor Type
        </span>
      ),
      cell: ({ getValue }) => (
        <span className="text-sm text-slate-600 dark:text-slate-400 capitalize">{String(getValue()).replace(/_/g, " ")}</span>
      ),
    },
    {
      accessorKey: "investmentAmount",
      header: () => (
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Investment
        </span>
      ),
      cell: ({ row }) => (
        <span className="text-sm text-slate-600 dark:text-slate-400">
          {row.original.investmentAmount} {row.original.investmentCurrency ?? "USD"}
        </span>
      ),
    },
    {
      accessorKey: "isPEP",
      header: () => (
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">PEP</span>
      ),
      cell: ({ getValue }) =>
        getValue() ? (
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">PEP</span>
        ) : (
          <span className="text-xs text-slate-500">No</span>
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
          {String(getValue()).slice(0, 20)}...
        </code>
      ),
    },
    {
      accessorKey: "status",
      header: () => (
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Status</span>
      ),
      cell: ({ getValue }) => <KYIStatusBadge status={getValue() as KYIStatus} size="sm" />,
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
        const value = getValue();
        if (!value) return <span className="text-slate-400 text-xs">—</span>;
        return <span className="text-sm text-slate-600 dark:text-slate-400">{format(new Date(String(value)), "MMM d, yyyy")}</span>;
      },
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <button
          onClick={() => router.push(`/kyi/${row.original.id}`)}
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
      <div className="flex flex-col xl:flex-row gap-3">
        <div className="relative flex-1 xl:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search name, email, reference..."
            value={globalFilter}
            onChange={(event) => setGlobalFilter(event.target.value)}
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
          <SelectTrigger className="w-full xl:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={investorTypeFilter} onValueChange={setInvestorTypeFilter}>
          <SelectTrigger className="w-full xl:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INVESTOR_TYPE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="bg-slate-50 dark:bg-slate-800/50">
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className="h-10">
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, index) => (
                <TableRow key={index}>
                  {columns.map((_, columnIndex) => (
                    <TableCell key={columnIndex}>
                      <div className="h-4 rounded bg-slate-100 dark:bg-slate-800 animate-pulse w-24" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-32 text-center">
                  <p className="text-slate-500 dark:text-slate-400 text-sm">No KYI records found</p>
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={cn("cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors")}
                  onClick={() => router.push(`/kyi/${row.original.id}`)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
        <p>
          Showing {table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1}–
          {Math.min(
            (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
            filteredData.length,
          )}{" "}
          of {filteredData.length} records
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm px-2">
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
          </span>
          <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
