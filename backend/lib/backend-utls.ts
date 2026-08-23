const apiUrl = process.env.DEEPTRACK_BACKEND_URL;

const BACKEND_URLS = {
	"Get All Company Members": `${apiUrl}/v1/users/company-members`,
	"Check if Company Head": `${apiUrl}/v1/companies/check-head`,
};

export { BACKEND_URLS };