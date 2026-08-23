import { Button } from "@/components/ui/button";
import { cn } from "@/backend/lib/utils";
import { Loader } from "lucide-react";
import type React from "react";

interface SubmitButtonProps {
	isSubmitting: boolean;
	text?: string;
	className?: string;
	disabled?: boolean;
	loaderText?: string;
	onClick?: () => void;
}

const SubmitButton: React.FC<SubmitButtonProps> = ({
	isSubmitting,
	text = "Submit",
	className,
	disabled,
	loaderText = "Saving",
	...props
}) => {
	return (
		<Button
			disabled={disabled || isSubmitting}
			onClick={props.onClick}
			type="submit"
			className={cn(className)}
			{...props}
		>
			{isSubmitting ? (
				<div className="flex items-center justify-center gap-1">
					<Loader className="size-4 animate-spin" /> {loaderText}
				</div>
			) : (
				text
			)}
		</Button>
	);
};

export default SubmitButton;