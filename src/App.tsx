import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

interface ScanItem {
	project_path: string;
	node_modules_path: string;
	size?: number | null;
}

interface ScanProgress {
	current_folder: string;
	folders_scanned: number;
	total_folders_estimated: number;
	node_modules_found: number;
	directories_skipped: number;
	is_complete: boolean;
}

interface DriveInfo {
	path: string;
	name: string;
}

interface DeleteResult {
	path: string;
	success: boolean;
	error?: string;
}

interface TreeNode {
	id: string;
	name: string;
	path: string;
	type: "folder" | "node_modules";
	children: TreeNode[];
	size?: number | null;
	isExpanded: boolean;
	isSelected: boolean;
	level: number;
}

type ScanScope = "folder" | "drive" | "entire";

function App() {
	const [scanScope, setScanScope] = useState<ScanScope>("folder");
	const [selectedFolder, setSelectedFolder] = useState("");
	const [selectedDrive, setSelectedDrive] = useState("");
	const [drives, setDrives] = useState<DriveInfo[]>([]);
	const [includeSizes, setIncludeSizes] = useState(false);
	const [isScanning, setIsScanning] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);
	const [scanProgress, setScanProgress] = useState<ScanProgress>({
		current_folder: "Starting scan...",
		folders_scanned: 0,
		total_folders_estimated: 0,
		node_modules_found: 0,
		directories_skipped: 0,
		is_complete: false,
	});
	const [scanResults, setScanResults] = useState<ScanItem[]>([]);
	const [treeData, setTreeData] = useState<TreeNode[]>([]);
	const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
	const [showDeleteModal, setShowDeleteModal] = useState(false);
	const [deleteTarget, setDeleteTarget] = useState<{
		type: "single" | "bulk";
		path?: string;
		count?: number;
	} | null>(null);
	const [isDarkMode, setIsDarkMode] = useState(false);
	const [scanStartTime, setScanStartTime] = useState<Date | null>(null);
	const [scanDuration, setScanDuration] = useState<string>("");

	// Load drives on component mount
	useEffect(() => {
		loadDrives();
		// Check system preference for dark mode
		if (
			window.matchMedia &&
			window.matchMedia("(prefers-color-scheme: dark)").matches
		) {
			setIsDarkMode(true);
		}
	}, []);

	// Apply dark mode to document
	useEffect(() => {
		if (isDarkMode) {
			document.documentElement.classList.add("dark");
		} else {
			document.documentElement.classList.remove("dark");
		}
	}, [isDarkMode]);

	// Listen for scan progress updates
	useEffect(() => {
		// Use the proper Tauri event listener
		const setupListener = async () => {
			try {
				const { listen } = await import("@tauri-apps/api/event");
				const unlisten = await listen("scan_progress", (event) => {
					const progress = event.payload as ScanProgress;
					setScanProgress(progress);

					// If scan is complete, update the results and show final duration
					if (progress.is_complete) {
						setIsScanning(false);
						// Keep the final duration visible for a few seconds
						setTimeout(() => {
							setScanStartTime(null);
						}, 5000);
					}
				});

				return unlisten;
			} catch (error) {
				console.error("Failed to setup event listener:", error);
				return null;
			}
		};

		let unlistenFn: (() => void) | null = null;
		setupListener().then((unlisten) => {
			unlistenFn = unlisten;
		});

		return () => {
			if (unlistenFn) {
				unlistenFn();
			}
		};
	}, []);

	// Timer effect for scan duration
	useEffect(() => {
		let interval: number | null = null;

		if (isScanning && scanStartTime) {
			interval = setInterval(() => {
				const now = new Date();
				const duration = now.getTime() - scanStartTime.getTime();
				const seconds = Math.floor(duration / 1000);
				const minutes = Math.floor(seconds / 60);
				const remainingSeconds = seconds % 60;

				if (minutes > 0) {
					setScanDuration(`${minutes}m ${remainingSeconds}s`);
				} else {
					setScanDuration(`${seconds}s`);
				}
			}, 1000);
		} else {
			setScanDuration("");
		}

		return () => {
			if (interval) {
				clearInterval(interval);
			}
		};
	}, [isScanning, scanStartTime]);

	// Build tree structure when scan results change
	useEffect(() => {
		if (scanResults.length > 0) {
			const tree = buildTreeFromResults(scanResults);
			setTreeData(tree);
		} else {
			setTreeData([]);
		}
	}, [scanResults]);

	const loadDrives = async () => {
		try {
			const drivesList = await invoke("list_drives");
			setDrives(drivesList as DriveInfo[]);
		} catch (error) {
			console.error("Failed to load drives:", error);
		}
	};

	const buildTreeFromResults = (results: ScanItem[]): TreeNode[] => {
		const treeMap = new Map<string, TreeNode>();
		const rootNodes: TreeNode[] = [];

		// Sort results by path to ensure proper hierarchy
		const sortedResults = [...results].sort((a, b) =>
			a.project_path.localeCompare(b.project_path)
		);

		for (const item of sortedResults) {
			const projectPathParts = item.project_path.split(/[\\\/]/);

			let currentPath = "";
			let parentNode: TreeNode | null = null;

			// Build the folder hierarchy
			for (let i = 0; i < projectPathParts.length; i++) {
				const part = projectPathParts[i];
				if (!part) continue;

				currentPath = currentPath ? `${currentPath}/${part}` : part;
				const nodeId = `folder-${currentPath}`;

				if (!treeMap.has(nodeId)) {
					// Create full absolute path for the folder
					const fullPath = projectPathParts.slice(0, i + 1).join("/");

					const newNode: TreeNode = {
						id: nodeId,
						name: part,
						path: fullPath,
						type: "folder",
						children: [],
						size: 0, // Initialize size to 0 for folders
						isExpanded: i < 2, // Auto-expand first few levels
						isSelected: false,
						level: i,
					};
					treeMap.set(nodeId, newNode);

					if (parentNode) {
						parentNode.children.push(newNode);
					} else {
						rootNodes.push(newNode);
					}
				}

				parentNode = treeMap.get(nodeId)!;
			}

			// Add the node_modules folder
			const nodeModulesId = `node_modules-${item.node_modules_path}`;
			const nodeModulesNode: TreeNode = {
				id: nodeModulesId,
				name: "node_modules",
				path: item.node_modules_path,
				type: "node_modules",
				children: [],
				size: item.size,
				isExpanded: false,
				isSelected: false,
				level: projectPathParts.length,
			};

			treeMap.set(nodeModulesId, nodeModulesNode);
			if (parentNode) {
				parentNode.children.push(nodeModulesNode);
			}
		}

		// Calculate folder sizes by summing up child sizes
		const calculateFolderSizes = (nodes: TreeNode[]): void => {
			nodes.forEach((node) => {
				if (node.type === "folder" && node.children.length > 0) {
					calculateFolderSizes(node.children);
					// Sum up all child sizes
					node.size = node.children.reduce((total, child) => {
						return total + (child.size || 0);
					}, 0);
				}
			});
		};

		calculateFolderSizes(rootNodes);

		return rootNodes;
	};

	const toggleNodeExpansion = (nodeId: string) => {
		const updateNode = (nodes: TreeNode[]): TreeNode[] => {
			return nodes.map((node) => {
				if (node.id === nodeId) {
					return { ...node, isExpanded: !node.isExpanded };
				}
				if (node.children.length > 0) {
					return { ...node, children: updateNode(node.children) };
				}
				return node;
			});
		};

		setTreeData((prev) => updateNode(prev));
	};

	const toggleNodeSelection = (nodeId: string, isSelected: boolean) => {
		const updateNode = (nodes: TreeNode[]): TreeNode[] => {
			return nodes.map((node) => {
				if (node.id === nodeId) {
					const updatedNode = { ...node, isSelected };

					// If this is a folder, update all children
					if (node.type === "folder" && node.children.length > 0) {
						updatedNode.children = updateNode(
							node.children.map((child) => ({ ...child, isSelected }))
						);
					}

					return updatedNode;
				}
				if (node.children.length > 0) {
					return { ...node, children: updateNode(node.children) };
				}
				return node;
			});
		};

		setTreeData((prev) => updateNode(prev));
		updateSelectedItems();
	};

	const updateSelectedItems = (currentTreeData?: TreeNode[]) => {
		const selectedPaths = new Set<string>();
		const dataToUse = currentTreeData || treeData;

		const collectSelectedPaths = (nodes: TreeNode[]) => {
			nodes.forEach((node) => {
				if (node.isSelected && node.type === "node_modules") {
					selectedPaths.add(node.path);
				}
				if (node.children.length > 0) {
					collectSelectedPaths(node.children);
				}
			});
		};

		collectSelectedPaths(dataToUse);
		setSelectedItems(selectedPaths);
	};

	const selectAllNodeModules = () => {
		const updateNode = (nodes: TreeNode[]): TreeNode[] => {
			return nodes.map((node) => {
				if (node.type === "node_modules") {
					return { ...node, isSelected: true };
				}
				if (node.children.length > 0) {
					return {
						...node,
						isExpanded: true,
						children: updateNode(node.children),
					};
				}
				return node;
			});
		};

		setTreeData((prev) => {
			const updatedData = updateNode(prev);
			// Update selected items immediately with the new data
			updateSelectedItems(updatedData);
			return updatedData;
		});
	};

	const deselectAllNodeModules = () => {
		const updateNode = (nodes: TreeNode[]): TreeNode[] => {
			return nodes.map((node) => {
				if (node.type === "node_modules") {
					return { ...node, isSelected: false };
				}
				if (node.children.length > 0) {
					return { ...node, children: updateNode(node.children) };
				}
				return node;
			});
		};

		setTreeData((prev) => {
			const updatedData = updateNode(prev);
			// Update selected items immediately with the new data
			updateSelectedItems(updatedData);
			return updatedData;
		});
	};

	const handleBrowseFolder = async () => {
		try {
			const result = await invoke("open_folder_dialog");
			if (result) {
				setSelectedFolder(result as string);
			} else {
				// If dialog returns None, use the fallback prompt
				const input = prompt(
					"Enter folder path (e.g., C:\\Users\\YourName\\Projects):"
				);
				if (input && input.trim()) {
					setSelectedFolder(input.trim());
				}
			}
		} catch (error) {
			console.error("Failed to open folder dialog:", error);
			// Fallback to prompt
			const input = prompt(
				"Enter folder path (e.g., C:\\Users\\YourName\\Projects):"
			);
			if (input && input.trim()) {
				setSelectedFolder(input.trim());
			}
		}
	};

	const handleStartScan = async () => {
		if (isScanning) return;

		let roots: string[] = [];

		switch (scanScope) {
			case "folder":
				if (!selectedFolder.trim()) {
					alert("Please select a folder to scan");
					return;
				}
				roots = [selectedFolder.trim()];
				break;
			case "drive":
				if (!selectedDrive) {
					alert("Please select a drive to scan");
					return;
				}
				roots = [selectedDrive];
				break;
			case "entire":
				// Get all available drives for entire computer scan
				roots = drives.map((d) => d.path);
				break;
		}

		if (roots.length === 0) {
			alert("No valid scan targets selected");
			return;
		}

		setIsScanning(true);
		setScanStartTime(new Date());
		setScanResults([]);
		setTreeData([]);
		setSelectedItems(new Set());
		setScanProgress({
			current_folder: "Starting scan...",
			folders_scanned: 0,
			total_folders_estimated: 0,
			node_modules_found: 0,
			directories_skipped: 0,
			is_complete: false,
		});

		try {
			// Use the progress-enabled scan command
			const results = (await invoke("start_scan_with_progress", {
				roots,
				includeSizes,
			})) as ScanItem[];
			setScanResults(results);
			// Progress updates will come through the event listener
		} catch (error) {
			console.error("Scan failed:", error);
			alert("Scan failed: " + error);
			setIsScanning(false);
		}
	};

	const handleOpenFolder = async (path: string) => {
		try {
			await invoke("open_folder_in_explorer", { path });
		} catch (error) {
			console.error("Failed to open folder:", error);
			alert("Failed to open folder: " + error);
		}
	};

	const handleBulkDelete = () => {
		if (selectedItems.size === 0) return;
		setDeleteTarget({ type: "bulk", count: selectedItems.size });
		setShowDeleteModal(true);
	};

	const confirmDelete = async () => {
		if (!deleteTarget) return;

		setIsDeleting(true);

		try {
			let paths: string[] = [];

			if (deleteTarget.type === "single" && deleteTarget.path) {
				paths = [deleteTarget.path];
			} else if (deleteTarget.type === "bulk") {
				paths = Array.from(selectedItems);
			}

			if (paths.length === 0) return;

			const results = (await invoke("delete_node_modules", {
				paths,
			})) as DeleteResult[];

			// Remove successfully deleted items
			const failedPaths = new Set(
				results.filter((r) => !r.success).map((r) => r.path)
			);
			setScanResults((prev) =>
				prev.filter((item) => !failedPaths.has(item.node_modules_path))
			);

			// Clear selection
			setSelectedItems(new Set());

			// Show results summary
			const successCount = results.filter((r) => r.success).length;
			const failCount = results.filter((r) => !r.success).length;

			if (failCount > 0) {
				alert(
					`Deleted ${successCount} folders successfully. ${failCount} failed.`
				);
			} else {
				alert(`Successfully deleted ${successCount} folders.`);
			}
		} catch (error) {
			console.error("Delete failed:", error);
			alert("Delete failed: " + error);
		} finally {
			setIsDeleting(false);
			setShowDeleteModal(false);
			setDeleteTarget(null);
		}
	};

	const formatFileSize = (bytes: number | null | undefined): string => {
		if (bytes === null || bytes === undefined) {
			return "—";
		}

		const units = ["B", "KB", "MB", "GB", "TB"];
		let size = bytes;
		let unitIndex = 0;

		while (size >= 1024 && unitIndex < units.length - 1) {
			size /= 1024;
			unitIndex++;
		}

		return `${size.toFixed(1)} ${units[unitIndex]}`;
	};

	const truncatePath = (path: string, maxLength: number = 60): string => {
		if (path.length <= maxLength) return path;

		const start = Math.floor(maxLength / 2) - 10;
		const end = path.length - Math.floor(maxLength / 2) + 10;

		return path.substring(0, start) + "..." + path.substring(end);
	};

	const toggleDarkMode = () => {
		console.log("Dark mode toggle clicked. Current state:", isDarkMode);
		const newState = !isDarkMode;
		console.log("Setting dark mode to:", newState);
		setIsDarkMode(newState);
	};

	const renderTreeNode = (node: TreeNode, depth: number = 0) => {
		const indent = depth * 24;
		const isNodeModules = node.type === "node_modules";
		const hasChildren = node.children.length > 0;

		return (
			<div key={node.id} className="w-full">
				<div
					className={`flex items-center py-1.5 px-2 rounded transition-colors duration-150 ${
						node.isSelected
							? isDarkMode
								? "bg-blue-900/20"
								: "bg-blue-50 border border-blue-200"
							: ""
					} ${isDarkMode ? "hover:bg-zinc-800/50" : "hover:bg-slate-100"}`}
					style={{ paddingLeft: `${12 + indent}px` }}
				>
					{/* Selection Checkbox */}
					<input
						type="checkbox"
						checked={node.isSelected}
						onChange={(e) => toggleNodeSelection(node.id, e.target.checked)}
						className="w-3.5 h-3.5 text-blue-600 bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-600 rounded focus:ring-blue-500 focus:ring-1 mr-2"
					/>

					{/* Expand/Collapse Icon */}
					{hasChildren && (
						<button
							onClick={() => toggleNodeExpansion(node.id)}
							className="mr-1.5 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors duration-150"
						>
							<svg
								className={`w-3.5 h-3.5 transform transition-transform duration-200 ${
									node.isExpanded ? "rotate-90" : ""
								}`}
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M9 5l7 7-7 7"
								/>
							</svg>
						</button>
					)}

					{/* Folder/File Icon */}
					<div className="mr-2">
						{isNodeModules ? (
							<svg
								className="w-4 h-4 text-red-500"
								fill="currentColor"
								viewBox="0 0 20 20"
							>
								<path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
							</svg>
						) : (
							<svg
								className="w-4 h-4 text-blue-500"
								fill="currentColor"
								viewBox="0 0 20 20"
							>
								<path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
							</svg>
						)}
					</div>

					{/* Node Name */}
					<div className="flex-1 min-w-0">
						<div className="flex items-center space-x-2">
							{node.type === "folder" ? (
								<button
									onClick={() => handleOpenFolder(node.path)}
									className={`text-sm font-medium hover:underline transition-colors duration-150 ${
										isDarkMode
											? "text-white hover:text-blue-400"
											: "text-slate-900 hover:text-blue-600"
									}`}
								>
									{node.name}
								</button>
							) : (
								<span
									className={`text-sm font-medium ${
										isNodeModules
											? isDarkMode
												? "text-red-300"
												: "text-red-700"
											: isDarkMode
											? "text-white"
											: "text-slate-900"
									}`}
								>
									{node.name}
								</span>
							)}

							{node.size !== null &&
								node.size !== undefined &&
								node.size > 0 && (
									<span
										className={`text-xs px-1.5 py-0.5 rounded ${
											isDarkMode
												? "text-zinc-400 bg-zinc-800"
												: "text-slate-600 bg-slate-100"
										}`}
									>
										{formatFileSize(node.size)}
									</span>
								)}
						</div>

						{/* Full Path (for node_modules) */}
						{isNodeModules && (
							<div
								className={`text-xs font-mono mt-0.5 ${
									isDarkMode ? "text-slate-400" : "text-slate-500"
								}`}
							>
								{truncatePath(node.path, 60)}
							</div>
						)}
					</div>

					{/* Actions */}
					{isNodeModules && (
						<div className="flex items-center ml-2 space-x-1">
							<button
								onClick={() => handleOpenFolder(node.path)}
								className={`text-xs font-medium hover:underline transition-colors duration-150 ${
									isDarkMode
										? "text-blue-400 hover:text-blue-300"
										: "text-blue-600 hover:text-blue-800"
								}`}
							>
								Open
							</button>
							<button
								onClick={() => {
									setDeleteTarget({ type: "single", path: node.path });
									setShowDeleteModal(true);
								}}
								className={`text-xs font-medium hover:underline transition-colors duration-150 ${
									isDarkMode
										? "text-red-400 hover:text-red-300"
										: "text-red-600 hover:text-red-800"
								}`}
							>
								Delete
							</button>
						</div>
					)}
				</div>

				{/* Render Children */}
				{hasChildren && node.isExpanded && (
					<div className="w-full">
						{node.children.map((child) => renderTreeNode(child, depth + 1))}
					</div>
				)}
			</div>
		);
	};

	return (
		<div
			className={`h-screen flex flex-col overflow-hidden ${
				isDarkMode
					? "text-white bg-black"
					: "bg-gradient-to-br via-blue-50 to-indigo-50 from-slate-50 text-slate-900"
			}`}
		>
			<div className="flex flex-col flex-1 p-4 min-h-0">
				{/* Header */}
				<div
					className={`flex justify-between items-center mb-4 border-b pb-4 ${
						isDarkMode ? "border-zinc-800" : "border-slate-200/60"
					}`}
				>
					<div className="flex items-center space-x-3">
						<div className="p-2 bg-blue-600 rounded-lg">
							<svg
								className="w-6 h-6 text-white"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
								/>
							</svg>
						</div>
						<div>
							<h1
								className={`text-2xl font-semibold ${
									isDarkMode ? "text-white" : "text-slate-900"
								}`}
							>
								NodeModules Cleaner
							</h1>
							<div className="flex items-center space-x-3">
								<p
									className={`text-sm ${
										isDarkMode ? "text-zinc-400" : "text-slate-700"
									}`}
								>
									Clean up your development environment
								</p>
								<div className="flex items-center px-2 py-1 space-x-1 bg-green-100 rounded-full border border-green-200 dark:bg-green-900/20 dark:border-green-800">
									<svg
										className="w-3 h-3 text-green-600 dark:text-green-400"
										fill="currentColor"
										viewBox="0 0 20 20"
									>
										<path
											fillRule="evenodd"
											d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
											clipRule="evenodd"
										/>
									</svg>
									<span className="text-xs font-medium text-green-700 dark:text-green-300">
										Safe Mode
									</span>
								</div>
							</div>
						</div>
					</div>
					<button
						onClick={toggleDarkMode}
						className={`p-2 rounded-lg transition-colors ${
							isDarkMode
								? "bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
								: "bg-slate-200 hover:bg-slate-300 text-slate-600"
						}`}
						title={`Switch to ${isDarkMode ? "light" : "dark"} mode`}
					>
						{isDarkMode ? (
							<svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
								<path
									fillRule="evenodd"
									d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z"
									clipRule="evenodd"
								/>
							</svg>
						) : (
							<svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
								<path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
							</svg>
						)}
					</button>
				</div>

				{/* Scope Selection Card */}
				<div
					className={`rounded-lg border p-6 mb-4 ${
						isDarkMode
							? "bg-zinc-900 border-zinc-800"
							: "shadow-lg backdrop-blur-sm bg-white/90 border-slate-200/50"
					}`}
				>
					<div className="flex justify-between items-start mb-4">
						<h2
							className={`text-lg font-semibold flex items-center ${
								isDarkMode ? "text-white" : "text-slate-900"
							}`}
						>
							<svg
								className="mr-2 w-5 h-5 text-blue-600"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
								/>
							</svg>
							Scan Scope
						</h2>

						{/* Safety Info Tooltip */}
						<div className="relative group">
							<button className="p-2 text-blue-600 transition-colors hover:text-blue-700">
								<svg
									className="w-5 h-5"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
									/>
								</svg>
							</button>
							<div className="absolute right-0 top-full invisible z-10 p-4 mt-2 w-80 bg-white rounded-lg border shadow-lg opacity-0 transition-all duration-200 dark:bg-zinc-800 border-slate-200 dark:border-zinc-700 group-hover:opacity-100 group-hover:visible">
								<h4 className="mb-2 font-medium text-slate-900 dark:text-white">
									Safety Features
								</h4>
								<ul className="space-y-1 text-sm text-slate-600 dark:text-zinc-400">
									<li>
										• Only scans development directories (skips system folders)
									</li>
									<li>• Multiple validation checks before deletion</li>
									<li>• Files moved to Recycle Bin (recoverable)</li>
									<li>• Smart detection prevents false positives</li>
								</ul>
							</div>
						</div>
					</div>

					<div className="space-y-4">
						{/* Folder Option */}
						<div className="flex items-center space-x-3">
							<input
								type="radio"
								id="scope-folder"
								name="scan-scope"
								value="folder"
								checked={scanScope === "folder"}
								onChange={(e) => setScanScope(e.target.value as ScanScope)}
								className="w-4 h-4 text-blue-600 bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-600 focus:ring-blue-500 focus:ring-2"
							/>
							<label
								htmlFor="scope-folder"
								className={`text-sm font-medium ${
									isDarkMode ? "text-white" : "text-slate-900"
								}`}
							>
								Folder
							</label>
							{scanScope === "folder" && (
								<div className="flex flex-1 items-center ml-4 space-x-2">
									<input
										type="text"
										value={selectedFolder}
										onChange={(e) => setSelectedFolder(e.target.value)}
										placeholder="Choose a folder or paste a path"
										className="flex-1 px-3 py-2 text-sm bg-white rounded border border-slate-300 dark:border-slate-600 dark:bg-slate-700 text-slate-900 dark:text-white placeholder-slate-500 dark:placeholder-slate-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
									/>
									<button
										onClick={handleBrowseFolder}
										className="px-4 py-2 text-sm font-medium rounded border transition-colors bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 border-slate-300 dark:border-slate-600"
									>
										Browse...
									</button>
								</div>
							)}
						</div>

						{/* Drive Option */}
						<div className="flex items-center space-x-3">
							<input
								type="radio"
								id="scope-drive"
								name="scan-scope"
								value="drive"
								checked={scanScope === "drive"}
								onChange={(e) => setScanScope(e.target.value as ScanScope)}
								className="w-4 h-4 text-blue-600 bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-600 focus:ring-blue-500 focus:ring-2"
							/>
							<label
								htmlFor="scope-drive"
								className={`text-sm font-medium ${
									isDarkMode ? "text-white" : "text-slate-900"
								}`}
							>
								Drive
							</label>
							{scanScope === "drive" && (
								<div className="flex-1 ml-4">
									<div className="mb-2 text-xs text-slate-600 dark:text-slate-400">
										Pick a drive to scan
									</div>
									<div className="flex flex-wrap gap-2">
										{drives.map((drive) => (
											<button
												key={drive.path}
												onClick={() => setSelectedDrive(drive.path)}
												className={`px-3 py-2 rounded text-xs font-medium transition-colors border ${
													selectedDrive === drive.path
														? "bg-blue-600 text-white border-blue-600"
														: "bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600 border-slate-300 dark:border-slate-600"
												}`}
											>
												{drive.name}
											</button>
										))}
									</div>
								</div>
							)}
						</div>

						{/* Entire Computer Option */}
						<div className="flex items-start space-x-3">
							<input
								type="radio"
								id="scope-entire"
								name="scan-scope"
								value="entire"
								checked={scanScope === "entire"}
								onChange={(e) => setScanScope(e.target.value as ScanScope)}
								className="w-4 h-4 text-blue-600 bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-600 focus:ring-blue-500 focus:ring-2 mt-0.5"
							/>
							<div>
								<label
									htmlFor="scope-entire"
									className={`text-sm font-medium ${
										isDarkMode ? "text-white" : "text-slate-900"
									}`}
								>
									Entire Computer
								</label>
								<div
									className={`text-xs mt-1 ${
										isDarkMode ? "text-slate-400" : "text-slate-600"
									}`}
								>
									Entire computer scan may take a long time. Results appear as
									they're found.
								</div>
							</div>
						</div>
					</div>

					{/* Options and Actions */}
					<div className="flex justify-between items-center pt-4 mt-4 border-t border-slate-200 dark:border-slate-700">
						<div className="flex items-center space-x-2">
							<input
								type="checkbox"
								id="include-sizes"
								checked={includeSizes}
								onChange={(e) => setIncludeSizes(e.target.checked)}
								className="w-4 h-4 text-blue-600 bg-white rounded dark:bg-slate-700 border-slate-300 dark:border-slate-600 focus:ring-blue-500 focus:ring-2"
							/>
							<label
								htmlFor="include-sizes"
								className={`text-sm font-medium ${
									isDarkMode ? "text-white" : "text-slate-900"
								}`}
							>
								Compute sizes (slower)
							</label>
						</div>

						<button
							onClick={handleStartScan}
							disabled={isScanning}
							className={`px-6 py-2 rounded transition-all duration-200 font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed ${
								isDarkMode
									? "text-white bg-blue-600 hover:bg-blue-700"
									: "text-white bg-gradient-to-r from-blue-600 to-indigo-600 shadow-lg transform hover:from-blue-700 hover:to-indigo-700 hover:shadow-xl hover:scale-105"
							}`}
						>
							{isScanning ? (
								<div className="flex items-center space-x-2">
									<div className="w-4 h-4 rounded-full border-2 border-white animate-spin border-t-transparent"></div>
									<span>Scanning...</span>
								</div>
							) : (
								"Start Scan"
							)}
						</button>
					</div>
				</div>

				{/* Progress Bar */}
				{isScanning && (
					<div
						className={`rounded-lg border p-4 mb-4 ${
							isDarkMode
								? "bg-zinc-900 border-zinc-800"
								: "shadow-lg backdrop-blur-sm bg-white/90 border-slate-200/50"
						}`}
					>
						<div className="flex justify-between items-center mb-3">
							<div className="flex items-center space-x-3">
								<span
									className={`text-sm font-semibold ${
										isDarkMode ? "text-white" : "text-slate-900"
									}`}
								>
									Scanning...
								</span>
								{scanDuration && (
									<span
										className={`text-xs px-2 py-1 rounded-full ${
											isDarkMode
												? "bg-slate-700 text-slate-300"
												: "bg-slate-100 text-slate-600"
										}`}
									>
										{scanDuration}
									</span>
								)}
							</div>
							<div className="flex items-center space-x-4">
								<span
									className={`text-sm ${
										isDarkMode ? "text-slate-400" : "text-slate-600"
									}`}
								>
									{scanProgress.node_modules_found} node_modules found
								</span>
								{scanProgress.directories_skipped > 0 && (
									<span
										className={`text-sm ${
											isDarkMode ? "text-slate-400" : "text-slate-600"
										}`}
									>
										{scanProgress.directories_skipped.toLocaleString()}{" "}
										directories skipped
									</span>
								)}
								{scanProgress.total_folders_estimated > 0 && (
									<span
										className={`text-sm ${
											isDarkMode ? "text-slate-400" : "text-slate-600"
										}`}
									>
										{scanProgress.folders_scanned.toLocaleString()} /{" "}
										{scanProgress.total_folders_estimated.toLocaleString()}{" "}
										folders
									</span>
								)}
							</div>
						</div>

						{/* Progress bar - only show when we have estimated folders */}
						{scanProgress.total_folders_estimated > 0 && (
							<div className="overflow-hidden mb-2 w-full h-2 rounded-full bg-slate-200 dark:bg-zinc-700">
								<div
									className="h-2 bg-blue-500 rounded-full transition-all duration-500 ease-out"
									style={{
										width: `${Math.min(
											(scanProgress.folders_scanned /
												Math.max(scanProgress.total_folders_estimated, 1)) *
												100,
											100
										)}%`,
									}}
								></div>
							</div>
						)}

						<div className="flex justify-between items-center mt-2">
							<div
								className={`text-xs truncate flex-1 ${
									isDarkMode ? "text-zinc-400" : "text-slate-500"
								}`}
							>
								<span className="font-medium">Status:</span>{" "}
								{scanProgress.current_folder}
							</div>
							{scanProgress.total_folders_estimated > 0 && (
								<div
									className={`text-xs ${
										isDarkMode ? "text-zinc-400" : "text-slate-500"
									}`}
								>
									{Math.round(
										(scanProgress.folders_scanned /
											Math.max(scanProgress.total_folders_estimated, 1)) *
											100
									)}
									%
								</div>
							)}
						</div>
					</div>
				)}

				{/* Tree View Results */}
				{treeData.length > 0 && (
					<div
						className={`flex-1 rounded-lg border flex flex-col min-h-0 max-h-full ${
							isDarkMode
								? "bg-zinc-900 border-zinc-800"
								: "shadow-lg backdrop-blur-sm bg-white/90 border-slate-200/50"
						}`}
					>
						<div
							className={`px-4 py-3 border-b flex-shrink-0 ${
								isDarkMode ? "border-zinc-800" : "border-slate-200"
							}`}
						>
							<div className="flex justify-between items-center">
								<div className="flex items-center space-x-4">
									<span
										className={`text-sm ${
											isDarkMode ? "text-zinc-400" : "text-slate-600"
										}`}
									>
										{selectedItems.size} of {scanResults.length} node_modules
										folders selected
									</span>
								</div>

								<div className="flex items-center space-x-2">
									<button
										onClick={selectAllNodeModules}
										className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-sm font-medium"
									>
										Select All
									</button>
									<button
										onClick={deselectAllNodeModules}
										className="px-3 py-1.5 bg-slate-600 text-white rounded hover:bg-slate-700 transition-colors text-sm font-medium"
									>
										Deselect All
									</button>
									{selectedItems.size > 0 && (
										<button
											onClick={handleBulkDelete}
											className="px-4 py-1.5 bg-red-600 text-white rounded hover:bg-red-700 transition-colors text-sm font-medium"
										>
											Delete Selected ({selectedItems.size})
										</button>
									)}
								</div>
							</div>
						</div>

						<div
							className="overflow-y-auto flex-1 p-2 min-h-0"
							style={{ maxHeight: "calc(100vh - 400px)" }}
						>
							{treeData.map((node) => renderTreeNode(node))}
						</div>
					</div>
				)}

				{/* Empty State */}
				{!isScanning && treeData.length === 0 && scanResults.length === 0 && (
					<div
						className={`flex-1 rounded-lg border flex items-center justify-center ${
							isDarkMode
								? "bg-zinc-900 border-zinc-800"
								: "shadow-lg backdrop-blur-sm bg-white/90 border-slate-200/50"
						}`}
					>
						<div className="text-center">
							<div
								className={`text-sm mb-2 ${
									isDarkMode ? "text-zinc-400" : "text-slate-600"
								}`}
							>
								Choose a scope and start scanning to see the folder hierarchy.
							</div>
							<div
								className={`inline-flex items-center space-x-2 px-3 py-1.5 rounded text-xs ${
									isDarkMode
										? "bg-zinc-800 text-zinc-400"
										: "bg-slate-100 text-slate-600"
								}`}
							>
								<svg
									className="w-3 h-3 text-green-500"
									fill="currentColor"
									viewBox="0 0 20 20"
								>
									<path
										fillRule="evenodd"
										d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
										clipRule="evenodd"
									/>
								</svg>
								<span>No data leaves your computer</span>
							</div>
						</div>
					</div>
				)}
			</div>

			{/* Delete Confirmation Modal */}
			{showDeleteModal && deleteTarget && (
				<div className="flex fixed inset-0 z-50 justify-center items-center bg-black/50">
					<div className="p-6 mx-4 w-full max-w-2xl bg-white rounded-lg border shadow-xl dark:bg-zinc-900 border-slate-200 dark:border-zinc-800">
						<div className="text-center">
							<div className="flex justify-center items-center mx-auto mb-4 w-12 h-12 bg-red-100 rounded-full dark:bg-red-900/20">
								<svg
									className="w-6 h-6 text-red-600 dark:text-red-400"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
									/>
								</svg>
							</div>
							<h3 className="mb-2 text-lg font-semibold text-slate-900 dark:text-white">
								{deleteTarget.type === "single"
									? "Delete this node_modules folder?"
									: `Delete ${deleteTarget.count} node_modules folders?`}
							</h3>

							{/* Safety Information */}
							<div className="p-4 mb-6 text-left bg-blue-50 rounded-lg border border-blue-200 dark:bg-blue-900/20 dark:border-blue-800">
								<div className="flex items-start space-x-3">
									<svg
										className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											strokeWidth={2}
											d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
										/>
									</svg>
									<div>
										<h4 className="mb-2 font-medium text-blue-900 dark:text-blue-100">
											Safety Features Enabled
										</h4>
										<ul className="space-y-1 text-sm text-blue-800 dark:text-blue-200">
											<li>
												• Files will be moved to Recycle Bin (not permanently
												deleted)
											</li>
											<li>
												• Multiple validation checks ensure only legitimate
												node_modules are deleted
											</li>
											<li>
												• You can recover files from Recycle Bin if needed
											</li>
										</ul>
									</div>
								</div>
							</div>

							{/* What Will Be Deleted */}
							{deleteTarget.type === "single" && deleteTarget.path && (
								<div className="p-3 mb-6 text-left rounded-lg border bg-slate-50 dark:bg-zinc-800 border-slate-200 dark:border-zinc-700">
									<div className="mb-2 text-sm font-medium text-slate-700 dark:text-zinc-300">
										Path to be deleted:
									</div>
									<div className="font-mono text-xs break-all text-slate-600 dark:text-zinc-400">
										{deleteTarget.path}
									</div>
								</div>
							)}

							<p className="mb-6 text-sm text-slate-600 dark:text-zinc-400">
								This action will move the selected node_modules folders to your
								system's Recycle Bin. You can recover them later if needed.
							</p>

							<div className="flex justify-center space-x-3">
								<button
									onClick={() => setShowDeleteModal(false)}
									disabled={isDeleting}
									className="px-4 py-2 text-sm font-medium rounded transition-colors bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
								>
									Cancel
								</button>
								<button
									onClick={confirmDelete}
									disabled={isDeleting}
									className="flex items-center px-4 py-2 space-x-2 text-sm font-medium text-white bg-red-600 rounded transition-colors hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
								>
									{isDeleting ? (
										<>
											<div className="w-3 h-3 rounded-full border-2 border-white animate-spin border-t-transparent"></div>
											<span>Deleting...</span>
										</>
									) : (
										"Move to Recycle Bin"
									)}
								</button>
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

export default App;
