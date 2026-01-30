import React from "react";

type AuthenticationCardProps = {
  token: string;
  onTokenChange: (value: string) => void;
  saveToken: boolean;
  onSaveTokenToggle: (value: boolean) => void;
};

export default function AuthenticationCard({
  token,
  onTokenChange,
  saveToken,
  onSaveTokenToggle,
}: AuthenticationCardProps) {
  return (
    <div className="bg-white rounded-lg shadow p-6 mb-6">
      <h2 className="text-xl font-semibold mb-4">Authentication</h2>
      <div className="space-y-4">
        <div>
          <label htmlFor="bearerToken" className="block text-sm font-medium text-gray-700 mb-2">
            Bearer Token
          </label>
          <input
            id="bearerToken"
            name="bearerToken"
            type="password"
            value={token}
            onChange={(e) => onTokenChange(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="Enter your Supplier Pro API token"
            autoComplete="off"
          />
        </div>
        <div className="flex items-center">
          <input
            type="checkbox"
            id="saveToken"
            name="saveToken"
            checked={saveToken}
            onChange={(e) => onSaveTokenToggle(e.target.checked)}
            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
          />
          <label htmlFor="saveToken" className="ml-2 block text-sm text-gray-700">
            Save token locally (localStorage)
          </label>
        </div>
      </div>
    </div>
  );
}

