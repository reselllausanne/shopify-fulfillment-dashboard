import React from "react";

type ActionBarProps = {
  onLoadFromDatabase: () => Promise<void>;
  dbLoading: boolean;
  token: string;
};

export default function ActionBar({
  onLoadFromDatabase,
  dbLoading,
  token,
}: ActionBarProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      <button
        onClick={onLoadFromDatabase}
        disabled={dbLoading}
        className="flex items-center justify-center gap-2 px-4 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium shadow"
      >
        {dbLoading ? "Loading..." : "📂 Load from Database"}
      </button>

      <a
        href="/dashboard"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-2 px-4 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 font-medium shadow"
      >
        📊 View Dashboard ↗
      </a>
    </div>
  );
}

