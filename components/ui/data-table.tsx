"use client";

import {
	type ColumnDef,
	type ColumnFiltersState,
	type SortingState,
	type VisibilityState,
	flexRender,
	getCoreRowModel,
	getFilteredRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	useReactTable,
} from "@tanstack/react-table";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import * as React from "react";

import EmptyState from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

interface DataTableProps<TData, TValue> {
	columns: ColumnDef<TData, TValue>[];
	data: TData[];
	columnFilterName?: string;
	tableTitle: string;
	displaySearch?: boolean;
	rowsPerPageProp?: number;
}

export function DataTable<TData, TValue>({
		columns,
		data,
		columnFilterName,
		tableTitle,
		displaySearch,
		rowsPerPageProp,
	}: DataTableProps<TData, TValue>) {
		const [sorting, setSorting] = React.useState<SortingState>([]);
		const [columnFilters, setColumnFilters] =
			React.useState<ColumnFiltersState>([]);
		const [columnVisibility, setColumnVisibility] =
			React.useState<VisibilityState>({});
		const [rowsPerPage] = React.useState(rowsPerPageProp ?? 10);
		const [{ pageIndex, pageSize }, setPagination] = React.useState({
			pageIndex: 0,
			pageSize: rowsPerPage,
		});

		const pagination = React.useMemo(
			() => ({
				pageIndex,
				pageSize,
			}),
			[pageIndex, pageSize],
		);

		const table = useReactTable({
			data,
			columns,
			getCoreRowModel: getCoreRowModel(),
			getPaginationRowModel: getPaginationRowModel(),
			onSortingChange: setSorting,
			getSortedRowModel: getSortedRowModel(),
			onColumnFiltersChange: setColumnFilters,
			getFilteredRowModel: getFilteredRowModel(),
			onColumnVisibilityChange: setColumnVisibility,
			onPaginationChange: setPagination,
			state: {
				sorting,
				columnFilters,
				columnVisibility,
				pagination,
			},
			pageCount: Math.ceil(data.length / pageSize),
			manualPagination: false,
		});

		return (
			<Card className="w-full">
				<CardHeader className="space-y-2">
					<CardTitle className="text-xl font-bold">{tableTitle}</CardTitle>
					<div className="flex items-center justify-between">
						{displaySearch && columnFilterName && (
							<div className="flex items-center py-4">
								<Input
									placeholder={`Filter ${columnFilterName}...`}
									value={
										(table
											.getColumn(columnFilterName)
											?.getFilterValue() as string) ?? ""
									}
									onChange={(event) =>
										table
											.getColumn(columnFilterName)
											?.setFilterValue(event.target.value)
									}
									className="max-w-sm"
								/>
							</div>
						)}
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="outline" className="ml-auto">
									Columns <ChevronDown className="ml-2 h-4 w-4" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="w-[150px]">
								{table
									.getAllColumns()
									.filter((column) => column.getCanHide())
									.map((column, index) => {
										return (
											<DropdownMenuCheckboxItem
												key={`${column.id}--${index * Math.PI}`}
												className="capitalize"
												checked={column.getIsVisible()}
												onCheckedChange={(value) =>
													column.toggleVisibility(!!value)
												}
											>
												{column.id}
											</DropdownMenuCheckboxItem>
										);
									})}
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</CardHeader>
				<CardContent>
					<div className="rounded-md border">
						<Table>
							<TableHeader>
								{table.getHeaderGroups().map((headerGroup, index) => (
									<TableRow key={`${headerGroup.id}++${Date.now() * index}`}>
										{headerGroup.headers.map((header, index) => {
											return (
												<TableHead
													key={`${header.id}++${index * 2}`}
													className="whitespace-nowrap"
												>
													{header.isPlaceholder
														? null
														: flexRender(
																header.column.columnDef.header,
																header.getContext(),
															)}
												</TableHead>
											);
										})}
									</TableRow>
								))}
							</TableHeader>
							<TableBody>
								{table.getRowModel().rows?.length ? (
									table.getRowModel().rows.map((row, index) => (
										<TableRow
											key={`${row.id}++${Date.now() * index}`}
											data-state={row.getIsSelected() && "selected"}
										>
											{row.getVisibleCells().map((cell, index) => (
												<TableCell key={`${cell.id}++${Date.now() * index}`}>
													{flexRender(
														cell.column.columnDef.cell,
														cell.getContext(),
													)}
												</TableCell>
											))}
										</TableRow>
									))
								) : (
									<TableRow>
										<TableCell
											colSpan={columns.length}
											className="h-24 text-center"
										>
											<EmptyState emptyText="No results found" />
										</TableCell>
									</TableRow>
								)}
							</TableBody>
						</Table>
					</div>
				</CardContent>
				<CardFooter className="flex flex-col md:flex-row items-center justify-between py-4 space-y-2 md:space-y-0">
					<div className="flex-1 text-sm text-muted-foreground text-center md:text-left">
						{table.getFilteredRowModel().rows.length} row(s) total
					</div>
					<div className="flex flex-col md:flex-row items-center space-y-2 md:space-y-0 md:space-x-6 lg:space-x-8">
						<div className="flex items-center space-x-2">
							<p className="text-sm font-medium">Rows per page</p>
							<Select
								value={`${table.getState().pagination.pageSize}`}
								onValueChange={(value) => {
									table.setPageSize(Number(value));
								}}
							>
								<SelectTrigger className="h-8 w-[70px]">
									<SelectValue
										placeholder={table.getState().pagination.pageSize}
									/>
								</SelectTrigger>
								<SelectContent side="top">
									{[10, 20, 30, 40, 50, 100, 150].map((pageSize) => (
										<SelectItem key={pageSize} value={`${pageSize}`}>
											{pageSize}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="flex w-[100px] items-center justify-center text-sm font-medium">
							Page {table.getState().pagination.pageIndex + 1} of{" "}
							{table.getPageCount()}
						</div>
						<div className="flex items-center space-x-2">
							<Button
								variant="outline"
								className="h-8 w-8 p-0"
								onClick={() => table.previousPage()}
								disabled={!table.getCanPreviousPage()}
							>
								<ChevronLeft className="h-4 w-4" />
							</Button>
							<Button
								variant="outline"
								className="h-8 w-8 p-0"
								onClick={() => table.nextPage()}
								disabled={!table.getCanNextPage()}
							>
								<ChevronRight className="h-4 w-4" />
							</Button>
						</div>
					</div>
				</CardFooter>
			</Card>
		);
	}