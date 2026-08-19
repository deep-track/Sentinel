import type { APIKey } from "@/lib/types/api-keys";
import { apiColumns } from "@/app/(platform)/api-keys/api-keys-columns";
import { DataTable } from "@/components/ui/data-table";
import React from "react";

type Props = {
	apiKeys: APIKey[];
};

const ApiKeysTable = (props: Props) => {
	return (
		<DataTable
			columns={apiColumns}
			data={props.apiKeys}
			tableTitle="Your API Keys"
		/>
	);
};

export default ApiKeysTable;