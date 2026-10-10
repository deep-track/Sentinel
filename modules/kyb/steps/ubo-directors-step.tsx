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
import { positionOptions } from "@/backend/lib/kyb-types";
import { cn } from "@/backend/lib/utils";
import { type KYBPerson, createEmptyPerson } from "@/modules/kyb/types";
import { todayIsoDate } from "@/modules/kyc/types";
import { Info, Plus, X } from "lucide-react";
import { useState } from "react";

type UBO = KYBPerson;

interface UBODirectorsStepProps {
	initialData: UBO[];
	onSubmit: (values: UBO[]) => void;
	/** Saves the people entered so far before going back. */
	onBack: (values: UBO[]) => void;
}

interface FormErrors {
	[key: string]: {
		firstName?: string;
		lastName?: string;
		dateOfBirth?: string;
		email?: string;
		idNumber?: string;
		position?: string;
		shareholding?: string;
	};
}

const ID_NUMBER_PATTERN = /^[A-Za-z0-9]{5,20}$/;

export function UBODirectorsStep({
	initialData,
	onSubmit,
	onBack,
}: UBODirectorsStepProps) {
	const [ubos, setUbos] = useState<UBO[]>(
		initialData.length > 0 ? initialData : [createEmptyPerson()],
	);
	const [errors, setErrors] = useState<FormErrors>({});

	const addPerson = () => {
		setUbos([...ubos, createEmptyPerson()]);
	};

	const removePerson = (id: string) => {
		if (ubos.length > 1) {
			setUbos(ubos.filter((u) => u.id !== id));
			setErrors((prev) => {
				const newErrors = { ...prev };
				delete newErrors[id];
				return newErrors;
			});
		}
	};

	const updatePerson = (id: string, field: keyof UBO, value: string) => {
		setUbos(ubos.map((u) => (u.id === id ? { ...u, [field]: value } : u)));
		setErrors((prev) => ({
			...prev,
			[id]: {
				...prev[id],
				[field]: undefined,
			},
		}));
	};

	const validateForm = (): boolean => {
		const newErrors: FormErrors = {};
		let isValid = true;

		ubos.forEach((ubo) => {
			const personErrors: FormErrors[string] = {};

			if (!ubo.firstName.trim()) {
				personErrors.firstName = "First name is required";
				isValid = false;
			}
			if (!ubo.lastName.trim()) {
				personErrors.lastName = "Last name is required";
				isValid = false;
			}
			if (!ubo.dateOfBirth) {
				personErrors.dateOfBirth = "Date of birth is required";
				isValid = false;
			} else if (ubo.dateOfBirth >= todayIsoDate()) {
				personErrors.dateOfBirth = "Date of birth must be in the past";
				isValid = false;
			}
			if (!ID_NUMBER_PATTERN.test(ubo.idNumber.trim())) {
				personErrors.idNumber = "ID number must be 5–20 letters or digits";
				isValid = false;
			}
			if (ubo.shareholding.trim()) {
				const share = Number(ubo.shareholding);
				if (!Number.isFinite(share) || share < 0 || share > 100) {
					personErrors.shareholding = "Enter a percentage between 0 and 100";
					isValid = false;
				}
			}
			if (!ubo.email.trim()) {
				personErrors.email = "Email is required";
				isValid = false;
			} else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ubo.email)) {
				personErrors.email = "Valid email is required";
				isValid = false;
			}
			if (!ubo.position) {
				personErrors.position = "Position is required";
				isValid = false;
			}

			if (Object.keys(personErrors).length > 0) {
				newErrors[ubo.id] = personErrors;
			}
		});

		setErrors(newErrors);
		return isValid;
	};

	const handleSubmit = () => {
		if (validateForm()) {
			onSubmit(ubos);
		}
	};

	return (
		<div>
			<div className="mb-6">
				<h2 className="text-xl font-semibold text-gray-900">UBO & Directors</h2>
				<p className="text-gray-500 text-sm mt-1">
					Add Ultimate Beneficial Owners and directors
				</p>
			</div>

			<div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
				<div className="flex gap-3">
					<Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
					<p className="text-sm text-blue-800">
						Each person listed will receive an email to complete their identity
						verification. KYB approval requires all listed individuals to
						complete this step.
					</p>
				</div>
			</div>

			<div className="space-y-6">
				{ubos.map((ubo, index) => (
					<div
						key={ubo.id}
						className="border rounded-lg p-4 bg-gray-50/50 relative"
					>
						<div className="flex justify-between items-center mb-4">
							<h3 className="font-medium text-gray-900">Person {index + 1}</h3>
							{ubos.length > 1 && (
								<button
									type="button"
									aria-label={`Remove person ${index + 1}`}
									onClick={() => removePerson(ubo.id)}
									className="p-1 hover:bg-red-100 rounded text-red-500"
								>
									<X className="w-5 h-5" />
								</button>
							)}
						</div>

						<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
							<div className="space-y-1">
								<Label htmlFor={`firstName-${ubo.id}`}>
									First Name <span className="text-red-500">*</span>
								</Label>
								<Input
									id={`firstName-${ubo.id}`}
									value={ubo.firstName}
									onChange={(e) =>
										updatePerson(ubo.id, "firstName", e.target.value)
									}
									placeholder="Enter first name"
									className={cn(
										"bg-white",
										errors[ubo.id]?.firstName && "border-red-500",
									)}
								/>
								{errors[ubo.id]?.firstName && (
									<p className="text-xs text-red-500">
										{errors[ubo.id].firstName}
									</p>
								)}
							</div>

							<div className="space-y-1">
								<Label htmlFor={`lastName-${ubo.id}`}>
									Last Name <span className="text-red-500">*</span>
								</Label>
								<Input
									id={`lastName-${ubo.id}`}
									value={ubo.lastName}
									onChange={(e) =>
										updatePerson(ubo.id, "lastName", e.target.value)
									}
									placeholder="Enter last name"
									className={cn(
										"bg-white",
										errors[ubo.id]?.lastName && "border-red-500",
									)}
								/>
								{errors[ubo.id]?.lastName && (
									<p className="text-xs text-red-500">
										{errors[ubo.id].lastName}
									</p>
								)}
							</div>

							<div className="space-y-1">
								<Label htmlFor={`dob-${ubo.id}`}>
									Date of Birth <span className="text-red-500">*</span>
								</Label>
								<Input
									id={`dob-${ubo.id}`}
									type="date"
									max={todayIsoDate()}
									value={ubo.dateOfBirth}
									onChange={(e) =>
										updatePerson(ubo.id, "dateOfBirth", e.target.value)
									}
									className={cn(
										"bg-white",
										errors[ubo.id]?.dateOfBirth && "border-red-500",
									)}
								/>
								{errors[ubo.id]?.dateOfBirth && (
									<p className="text-xs text-red-500">
										{errors[ubo.id].dateOfBirth}
									</p>
								)}
							</div>

							<div className="space-y-1">
								<Label htmlFor={`email-${ubo.id}`}>
									Email Address <span className="text-red-500">*</span>
								</Label>
								<Input
									id={`email-${ubo.id}`}
									type="email"
									value={ubo.email}
									onChange={(e) =>
										updatePerson(ubo.id, "email", e.target.value)
									}
									placeholder="Enter email address"
									className={cn(
										"bg-white",
										errors[ubo.id]?.email && "border-red-500",
									)}
								/>
								{errors[ubo.id]?.email && (
									<p className="text-xs text-red-500">{errors[ubo.id].email}</p>
								)}
							</div>

							<div className="space-y-1">
								<Label htmlFor={`idNumber-${ubo.id}`}>
									ID / Passport Number <span className="text-red-500">*</span>
								</Label>
								<Input
									id={`idNumber-${ubo.id}`}
									value={ubo.idNumber}
									onChange={(e) =>
										updatePerson(ubo.id, "idNumber", e.target.value)
									}
									placeholder="e.g. A1234567"
									autoComplete="off"
									className={cn(
										"bg-white",
										errors[ubo.id]?.idNumber && "border-red-500",
									)}
								/>
								{errors[ubo.id]?.idNumber && (
									<p className="text-xs text-red-500">{errors[ubo.id].idNumber}</p>
								)}
							</div>

							<div className="space-y-1">
								<Label htmlFor={`position-${ubo.id}`}>
									Position <span className="text-red-500">*</span>
								</Label>
								<Select
									value={ubo.position}
									onValueChange={(value) =>
										updatePerson(ubo.id, "position", value)
									}
								>
									<SelectTrigger
										id={`position-${ubo.id}`}
										className={cn(
											"bg-white",
											errors[ubo.id]?.position && "border-red-500",
										)}
									>
										<SelectValue placeholder="Select position" />
									</SelectTrigger>
									<SelectContent>
										{positionOptions.map((option) => (
											<SelectItem key={option.value} value={option.value}>
												{option.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								{errors[ubo.id]?.position && (
									<p className="text-xs text-red-500">
										{errors[ubo.id].position}
									</p>
								)}
							</div>

							<div className="space-y-1">
								<Label htmlFor={`shareholding-${ubo.id}`}>Shareholding %</Label>
								<Input
									id={`shareholding-${ubo.id}`}
									type="number"
									min="0"
									max="100"
									value={ubo.shareholding}
									onChange={(e) =>
										updatePerson(ubo.id, "shareholding", e.target.value)
									}
									placeholder="0-100"
									className={cn(
										"bg-white",
										errors[ubo.id]?.shareholding && "border-red-500",
									)}
								/>
								{errors[ubo.id]?.shareholding && (
									<p className="text-xs text-red-500">{errors[ubo.id].shareholding}</p>
								)}
							</div>
						</div>
					</div>
				))}
			</div>

			<Button
				type="button"
				variant="outline"
				className="w-full mt-4"
				onClick={addPerson}
			>
				<Plus className="w-4 h-4 mr-2" />
				Add Another Person
			</Button>

			<div className="flex justify-between pt-6">
				<Button type="button" variant="outline" onClick={() => onBack(ubos)}>
					Back
				</Button>
				<Button
					type="button"
					onClick={handleSubmit}
					className="bg-violet-600 hover:bg-violet-700 text-white"
				>
					Continue
				</Button>
			</div>
		</div>
	);
}
