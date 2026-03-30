"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { businessInfoSchema, countries } from "@/lib/kyb-types";
import { zodResolver } from "@hookform/resolvers/zod";
import { Search } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

interface BusinessInfoStepProps {
	initialData: {
		businessName: string;
		registrationNumber: string;
		country: string;
	};
	onSubmit: (values: {
		businessName: string;
		registrationNumber: string;
		country: string;
	}) => void;
}

export function BusinessInfoStep({
	initialData,
	onSubmit,
}: BusinessInfoStepProps) {
	const [searchQuery, setSearchQuery] = useState("");
	const [showDropdown, setShowDropdown] = useState(false);

	const {
		register,
		handleSubmit,
		setValue,
		watch,
		formState: { errors },
	} = useForm({
		resolver: zodResolver(businessInfoSchema),
		defaultValues: initialData,
	});

	const selectedCountry = watch("country");

	const filteredCountries = countries.filter((country) =>
		country.name.toLowerCase().includes(searchQuery.toLowerCase()),
	);

	const handleCountrySelect = (countryCode: string) => {
		setValue("country", countryCode);
		setShowDropdown(false);
		setSearchQuery("");
	};

	const selectedCountryName = countries.find(
		(c) => c.code === selectedCountry,
	)?.name;

	return (
		<div>
			<div className="mb-6">
				<h2 className="text-xl font-semibold text-gray-900">
					Business Information
				</h2>
				<p className="text-gray-500 text-sm mt-1">
					Enter your business details for verification
				</p>
			</div>

			<form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
				<div className="space-y-2">
					<Label htmlFor="businessName">
						Business Name <span className="text-red-500">*</span>
					</Label>
					<Input
						id="businessName"
						{...register("businessName")}
						placeholder="Enter your business name"
						className={errors.businessName ? "border-red-500" : ""}
					/>
					{errors.businessName && (
						<p className="text-sm text-red-500">
							{errors.businessName.message}
						</p>
					)}
				</div>

				<div className="space-y-2">
					<Label htmlFor="registrationNumber">
						Registration Number <span className="text-red-500">*</span>
					</Label>
					<Input
						id="registrationNumber"
						{...register("registrationNumber")}
						placeholder="Enter business registration number"
						className={errors.registrationNumber ? "border-red-500" : ""}
					/>
					{errors.registrationNumber && (
						<p className="text-sm text-red-500">
							{errors.registrationNumber.message}
						</p>
					)}
				</div>

				<div className="space-y-2">
					<Label>
						Country <span className="text-red-500">*</span>
					</Label>
					<div className="relative">
						<div className="relative">
							<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
							<Input
								placeholder="Search for a country..."
								value={showDropdown ? searchQuery : selectedCountryName || ""}
								onFocus={() => setShowDropdown(true)}
								onChange={(e) => {
									setSearchQuery(e.target.value);
									setShowDropdown(true);
								}}
								className="pl-10"
							/>
						</div>
						{showDropdown && (
							<div className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-60 overflow-auto">
								{filteredCountries.length === 0 ? (
									<div className="p-3 text-sm text-gray-500">
										No country found
									</div>
								) : (
									filteredCountries.map((country) => (
										<button
											key={country.code}
											type="button"
											onClick={() => handleCountrySelect(country.code)}
											className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100"
										>
											{country.name}
										</button>
									))
								)}
							</div>
						)}
					</div>
					{errors.country && (
						<p className="text-sm text-red-500">{errors.country.message}</p>
					)}
					<input type="hidden" {...register("country")} />
				</div>

				<div className="flex justify-end pt-4">
					<Button
						type="submit"
						className="min-w-[120px] bg-violet-600 hover:bg-violet-700 text-white"
					>
						Continue
					</Button>
				</div>
			</form>
		</div>
	);
}
