// ========== Endpoint Tree Functions ==========
const collapsedEndpoints = new Set();
var activeTypeFilters = new Set();

function setEmptyStateVisibility(show) {
	var aside = document.querySelector('aside.endpoint.list');
	if (!aside) return;
	aside.classList.toggle('show-empty-state', show);
}

function collapseAllEndpointNodes() {
	// 收集所有节点ID
	var ids = [];
	function collectIds(nodes) {
		nodes.forEach(function(n) {
			ids.push(n.id);
			if (n.children) collectIds(n.children);
		});
	}
	collectIds(getGroups());
	ids.forEach(function(id) { collapsedEndpoints.add(id); });
	// 直接操作DOM收起
	$$('aside .one.endpoint').forEach(function(el) {
		var detailsEl = el.querySelector('details');
		if (detailsEl) detailsEl.open = false;
	});
}

// ========== Event Handlers (moved from inline JS to named functions) ==========

function handleDetailsToggle(detailsEl) {
	var nodeEl = detailsEl.closest('.one.endpoint');
	var nodeId = nodeEl.dataset.nodeId;
	if (detailsEl.open)
		collapsedEndpoints.delete(nodeId);
	else
		collapsedEndpoints.add(nodeId);
}

function handleDragStart(e, handleEl) {
	var nodeEl = handleEl.closest('.one.endpoint');
	e.dataTransfer.setData("text/plain", nodeEl.dataset.nodeId);
	e.dataTransfer.effectAllowed = "move";
	nodeEl.classList.add("dragging");
}

function handleDragEnd(handleEl) {
	var nodeEl = handleEl.closest('.one.endpoint');
	nodeEl.classList.remove("dragging");
	document.querySelectorAll(".one.endpoint").forEach(function(el) {
		el.classList.remove("drag-over", "drag-over-child", "drag-over-before", "drag-over-after");
	});
}

function handleSummaryTooltipMouseover(e, summaryEl) {
	var opListEl = summaryEl.closest('details').querySelector('.op');
	if (opListEl && opListEl.contains(e.target)) {
		if (summaryEl._tooltip) summaryEl._tooltip.hide();
		return;
	}
	if (summaryEl._tooltip) summaryEl._tooltip.show();
}

function handleSummaryTooltipMouseleave(summaryEl) {
	if (summaryEl._tooltip) summaryEl._tooltip.hide();
}

function handleSummaryTooltipClick(summaryEl) {
	if (summaryEl._tooltip) summaryEl._tooltip.hide();
}

function handleAddChildClick(btn) {
	var nodeEl = btn.closest('.one.endpoint');
	var nodeId = nodeEl.dataset.nodeId;
	showEditGroupDialog(null, nodeId, function(data) {
		addNode(nodeId, data).then(function() { refreshUI(); });
	});
}

function handleBatchTestClick(btn) {
	var ids = JSON.parse(btn.dataset.testableIds || '[]');
	ids.forEach(function(id) { testConnection(id); });
	btn.classList.add("busy");
}

function handleJoinSessionChange(cb) {
	var nodeEl = cb.closest('.one.endpoint');
	var nodeId = nodeEl.dataset.nodeId;
	if (selectedEndpoints.includes(nodeId)) {
		selectedEndpoints = selectedEndpoints.filter(function(x) { return x !== nodeId; });
	} else {
		selectedEndpoints.push(nodeId);
	}
	saveDefaultSelectedEndpoints(selectedEndpoints);
	renderSelectedEndpoints(getGroups(), selectedEndpoints, false);
	applyJoinBtnUI(cb.closest('.join-session'), nodeId);
}

function handleEditNodeClick(btn) {
	var nodeId = btn.closest('.one.endpoint').dataset.nodeId;
	handleNodeEdit(nodeId);
}

async function handleDuplicateNodeClick(btn) {
	var nodeId = btn.closest('.one.endpoint').dataset.nodeId;
	await cloneNode(nodeId);
	refreshUI();
}

function handleRemoveNodeClick(btn) {
	var nodeEl = btn.closest('.one.endpoint');
	var nodeId = nodeEl.dataset.nodeId;
	var nodeName = nodeEl.querySelector('.name').textContent;
	confirmAction("确定删除节点「" + nodeName + "」及其所有子节点和端点？", function() {
		handleNodeDelete(nodeId);
	});
}

function handleNodeDragover(e, nodeEl) {
	e.preventDefault(); e.stopPropagation();
	e.dataTransfer.dropEffect = "move";
	var draggingEl = document.querySelector(".dragging");
	if (!draggingEl || draggingEl === nodeEl) return;
	var summary = nodeEl.querySelector("summary");
	var summaryRect = summary.getBoundingClientRect();
	nodeEl.classList.remove("drag-over-before", "drag-over-after", "drag-over-child");
	if (e.clientY >= summaryRect.top && e.clientY <= summaryRect.bottom) {
		if (e.clientY < summaryRect.top + summaryRect.height / 2) {
			nodeEl.classList.add("drag-over-before");
		} else {
			nodeEl.classList.add("drag-over-child");
		}
	} else {
		nodeEl.classList.add("drag-over-child");
	}
}

function handleNodeDragleave(nodeEl) {
	nodeEl.classList.remove("drag-over-before", "drag-over-after", "drag-over-child");
}

function handleNodeDrop(e, nodeEl) {
	e.preventDefault(); e.stopPropagation();
	var willMoveAsChild = nodeEl.classList.contains("drag-over-child");
	nodeEl.classList.remove("drag-over-before", "drag-over-after", "drag-over-child");
	var draggedId = e.dataTransfer.getData("text/plain");
	if (!draggedId || draggedId === nodeEl.dataset.nodeId) return;
	if (willMoveAsChild) {
		handleMoveNodeAsChild(draggedId, nodeEl.dataset.nodeId);
	} else {
		handleReorderNode(draggedId, nodeEl.dataset.nodeId, true);
	}
}

function handleResetFilter() {
	document.querySelectorAll('.endpoint-type.filter input[type="checkbox"]').forEach(function(cb) { cb.checked = true; });
	activeTypeFilters.clear();
	document.querySelectorAll('.endpoint-type.filter input[type="checkbox"]:checked').forEach(function(cb) { activeTypeFilters.add(cb.value); });
	applyEndpointFilter();
	updateEmptyState();
}

function handleClickAddEndpoint() {
	handleAddGroup();
}

function handleFilterBarChange(e) {
	var checkbox = e.target.closest('input[type="checkbox"]');
	if (!checkbox) return;
	if (checkbox.checked) activeTypeFilters.add(checkbox.value);
	else activeTypeFilters.delete(checkbox.value);
	applyEndpointFilter();
	updateEmptyState();
}

function renderEndpointList(nodes, onNodeEdit, onNodeDelete, onReorderNodes, onTestConnection, onMoveNode) {
	var container = document.querySelector("aside.endpoint.list > ol");

	container.querySelectorAll('li').forEach(el => el.remove());

	function renderTreeNode(nodes, parentEl) {
		nodes.forEach(function(node, index) {
			var hasChildren = node.children && node.children.length > 0;
			var isCollapsed = collapsedEndpoints.has(node.id);
			var hasContent = hasChildren;
			var nodeEl = fromTemplate('one-endpoint', 'li');
			if (!hasChildren) nodeEl.classList.add('compact');
			nodeEl.dataset.nodeId = node.id;
			nodeEl.dataset.nodeIndex = index;
			var summaryEl = nodeEl.querySelector('details > summary');
			var dragHandle = nodeEl.querySelector('.handle');
			dragHandle.title = "拖动排序";

			var detailsEl = nodeEl.querySelector('details');
			detailsEl.open = hasContent && !isCollapsed;


			var nameSpan = nodeEl.querySelector('.name');
			var rcfg = resolveNodeConfig(node.id);
			nameSpan.textContent = node.name;

			// 设置类型标签
			var typeEl = nodeEl.querySelector('.endpoint-type');
			if (typeEl) {
				var type = rcfg ? rcfg.type : 'chat';
				if (type === 'chat') { typeEl.classList.add('chat'); }
				else if (type === 'embedding') { typeEl.classList.add('digits'); }
				else if (type === 'image' || type === 'image-generation') { typeEl.classList.add('palette'); }
				else if (type === 'reranking') { typeEl.classList.add('chart'); }
			}

			var tooltipId = "tooltip-" + node.id;
			var tooltipHTML = buildTooltipHTML(node, rcfg, node.name);
			nameSpan._tooltip = createTooltip(tooltipId, nameSpan, tooltipHTML);


			var opListEl = nodeEl.querySelector('.op');
			var addChildBtn = opListEl.querySelector('.add-child');
			// 模板事件绑定（取代 HTML onxxx）
			detailsEl.addEventListener("toggle", e => handleDetailsToggle(e.currentTarget));
			summaryEl.addEventListener("mouseover", e => handleSummaryTooltipMouseover(e, e.currentTarget));
			summaryEl.addEventListener("mouseleave", e => handleSummaryTooltipMouseleave(e.currentTarget));
			summaryEl.addEventListener("click", e => handleSummaryTooltipClick(e.currentTarget));
			dragHandle.addEventListener("dragstart", e => handleDragStart(e, e.currentTarget));
			dragHandle.addEventListener("dragend", e => handleDragEnd(e.currentTarget));
			addChildBtn.addEventListener("click", e => { e.stopPropagation(); handleAddChildClick(e.currentTarget); });
			opListEl.querySelector(".test-connection").addEventListener("click", e => { e.stopPropagation(); handleBatchTestClick(e.currentTarget); });
			opListEl.querySelector(".join-session input").addEventListener("change", e => { e.stopPropagation(); handleJoinSessionChange(e.currentTarget); });
			opListEl.querySelector(".edit").addEventListener("click", e => { e.stopPropagation(); handleEditNodeClick(e.currentTarget); });
			opListEl.querySelector(".duplicate").addEventListener("click", e => { e.stopPropagation(); handleDuplicateNodeClick(e.currentTarget); });
			opListEl.querySelector(".remove").addEventListener("click", e => { e.stopPropagation(); handleRemoveNodeClick(e.currentTarget); });


			function isNodeTestable(n) {
				var cfg = resolveNodeConfig(n.id);
				if (!cfg || !cfg.baseUrl || cfg.key === undefined || cfg.key === null || !cfg.modelId) return false;
				return cfg.type === 'chat' || cfg.type === 'embedding' || cfg.type === 'embed';
			}

			function collectTestable(nds, out) {
                nds.forEach(function(n) {
                    if (isNodeTestable(n)) {
                        out.push(n.id);
                    }

                    if (n.children)
                        collectTestable(n.children, out);
                });
            }

			var testableIds = [];
			collectTestable([node], testableIds);
			var isSelfTestable = testableIds.indexOf(node.id) >= 0;
			var childTestable = testableIds.length - (isSelfTestable ? 1 : 0);
			var hasTesting = false, allOk = true, anyFailed = false;

			testableIds.forEach(function(id) {
				var sd = connectionStatus.get(id);

				if (sd) {
					if (sd.status === "testing")
						hasTesting = true;

					if (sd.status === "connected")
						{} else if (sd.status === "testing")
						{} else {
						allOk = false;

						if (sd.status !== "disconnected")
							anyFailed = true;
					}
				} else {
					allOk = false;
				}
			});

			var batchStatus = "";

			if (testableIds.length > 0) {
				var allTested = testableIds.every(function(id) {
					var sd = connectionStatus.get(id);
					return sd && sd.status !== "disconnected" && sd.status !== undefined;
				});

				if (allTested && allOk)
					batchStatus = "connected";
				else if (anyFailed || (allTested && !allOk))
					batchStatus = "failed";
			}

			var batchTestBtn = opListEl.querySelector('.test-connection');
			if (testableIds.length === 0) {
				batchTestBtn.classList.add('hidden');
			} else {
				batchTestBtn.classList.remove("busy", "connected", "failed");
				if (batchStatus) batchTestBtn.classList.add(batchStatus);
				if (hasTesting) {
					batchTestBtn.classList.add("busy");
				}
				if (!hasTesting) {
					var successCount = 0, failCount = 0, firstError = null;

					testableIds.forEach(function(id) {
						var sd = connectionStatus.get(id);

						if (sd) {
							if (sd.status === "connected")
								successCount++;
							else if (sd.status === "failed" || sd.status === "cors_blocked") {
								failCount++;

								if (!firstError && sd.error)
									firstError = sd.error;
							}
						}
					});

					var testSummary = "";

					if (failCount > 0) {
						testSummary = "✗ " + failCount + "个失败";

						if (firstError)
							testSummary += "：" + firstError;
					} else if (successCount > 0 && successCount === testableIds.length) {
						testSummary = "✓ 全部成功";
					}

					if (childTestable > 0) {
						batchTestBtn.title = "测试连接（含" + (testableIds.length) + "个端点）" + (testSummary ? " — " + testSummary : "");
					} else {
						batchTestBtn.title = getConnectionStatusText(node.id);
					}
				} else {
					batchTestBtn.title = "测试中...";
				}

				batchTestBtn.dataset.testableIds = JSON.stringify(testableIds);
			}

			var joinBtn = opListEl.querySelector('.join-session');
			applyJoinBtnUI(joinBtn, node.id);
			var cb = joinBtn.querySelector("input[type=checkbox]");

			var editBtn = opListEl.querySelector('.edit');


			var duplicateBtn = opListEl.querySelector('.duplicate');


			var deleteBtn = opListEl.querySelector('.remove');


			var remSpan = nodeEl.querySelector(".remark");
			if (remSpan && node.remark) {
				remSpan.textContent = " " + node.remark;
			}

			nodeEl.ondragover = function(e) { handleNodeDragover(e, nodeEl); };
			nodeEl.ondragleave = function() { handleNodeDragleave(nodeEl); };
			nodeEl.ondrop = function(e) { handleNodeDrop(e, nodeEl); };


			if (hasContent) {
				var contentEl = mk("ol", "children");
				contentEl.style.gap = "var(--space-1)";

				renderTreeNode(node.children, contentEl);
				detailsEl.addChild(contentEl);
			}
			parentEl.addChild(nodeEl);
		});
	}

	renderTreeNode(nodes, container);
	var testAllBtn = $(".test-all");

	if (testAllBtn && typeof getGroups === "function") {
		var testableIds = [];

		function collectTestable(ns) {
            ns.forEach(function(n) {
                var rcfg = resolveNodeConfig(n.id);

                if (rcfg && rcfg.baseUrl && rcfg.modelId && (rcfg.type === "chat" || rcfg.type === "embedding" || rcfg.type === "embed"))
                    testableIds.push(n.id);

                if (n.children)
                    collectTestable(n.children);
            });
        }

		collectTestable(getGroups());
		var hasTesting = false, hasFail = false, hasSuccess = false;

		testableIds.forEach(function(id) {
			var sd = connectionStatus.get(id);

			if (sd) {
				if (sd.status === "testing")
					hasTesting = true;
				else if (sd.status === "connected")
					hasSuccess = true;
				else if (sd.status === "failed" || sd.status === "cors_blocked")
					hasFail = true;
			}
		});

		testAllBtn.classList.add("test-connection");

		if (hasTesting) {
			testAllBtn.classList.add("busy");
		} else {
			if (hasFail && !hasSuccess)
				testAllBtn.classList.add("failed");
			else if (hasSuccess && !hasFail)
				testAllBtn.classList.add("connected");
		}
	}
	// 初始化类型筛选（仅首次）
	initEndpointFilter();

	// 重新应用当前的类型筛选
	applyEndpointFilter();
	updateEmptyState();
}

function updateEmptyState() {
	var aside = document.querySelector('aside.endpoint.list');
	var emptyState = aside ? aside.querySelector('.empty-state') : null;
	var emptyHint = emptyState ? emptyState.querySelector('.hint') : null;
	var resetBtn = emptyState ? emptyState.querySelector('.reset-filter') : null;
	var addBtn = emptyState ? emptyState.querySelector('.add-endpoint') : null;
	if (!aside || !emptyState) return;

	var groups = getGroups();
	var totalNodes = document.querySelectorAll('aside.endpoint.list li.one.endpoint').length;
	var hiddenNodes = document.querySelectorAll('aside.endpoint.list li.one.endpoint[style*="display: none"]').length;
	var hasVisible = totalNodes - hiddenNodes;

	if (groups.length === 0) {
		// 没有建过任何端点：隐藏 ol，显示 empty-state
		aside.classList.add('show-empty-state');
		emptyState.classList.remove('hidden');
		emptyHint.textContent = '目前还没有创建端点。';
		resetBtn.classList.add('hidden');
		addBtn.classList.remove('hidden');
	} else if (groups.length > 0 && hasVisible === 0 && activeTypeFilters.size > 0 && activeTypeFilters.size < 4) {
		// 筛选后无结果：隐藏 ol，显示 empty-state
		aside.classList.add('show-empty-state');
		emptyState.classList.remove('hidden');
		emptyHint.textContent = '没有符合筛选的端点。';
		resetBtn.classList.remove('hidden');
		addBtn.classList.add('hidden');
	} else {
		// 有可见端点：恢复 ol，隐藏 empty-state
		aside.classList.remove('show-empty-state');
		emptyState.classList.add('hidden');
	}

}

// 端点类型筛选
function initEndpointFilter() {
	var filterBar = document.querySelector('.endpoint-type.filter');
	if (!filterBar || filterBar.dataset.initialized) return;
	filterBar.dataset.initialized = 'true';

	// 从 checkbox 默认状态初始化 activeTypeFilters
	activeTypeFilters.clear();
	filterBar.querySelectorAll('input[type="checkbox"]').forEach(function(cb) {
		if (cb.checked) activeTypeFilters.add(cb.value);
	});

}

function applyEndpointFilter() {
	var items = document.querySelectorAll('aside.endpoint.list li.one.endpoint');
	for (var i = items.length - 1; i >= 0; i--) {
		var li = items[i];
		var typeEl = li.querySelector('.endpoint-type');
		var type = '';
		if (typeEl) {
			if (typeEl.classList.contains('chat')) type = 'chat';
			else if (typeEl.classList.contains('digits')) type = 'embedding';
			else if (typeEl.classList.contains('palette')) type = 'image-generation';
			else if (typeEl.classList.contains('chart')) type = 'reranking';
		}

		if (activeTypeFilters.has(type)) {
			li.classList.remove('hidden');
		} else {
			// 分组节点：如果有子节点匹配，也显示
			var hasMatchingChild = false;
			var sublist = li.querySelector('details > ol');
			if (sublist) {
				hasMatchingChild = Array.from(sublist.querySelectorAll('li.one.endpoint')).some(function(child) {
					return !child.classList.contains('hidden');
				});
			}
			li.classList.toggle('hidden', !hasMatchingChild);
		}
	}
}
function updateEndpointTestUI(nodeId) {
	var nodeEl = document.querySelector('.one.endpoint[data-node-id="' + nodeId + '"]');
	if (nodeEl) {
		var testBtn = nodeEl.querySelector('.test-connection');
		if (testBtn) {
			testBtn.classList.remove('busy', 'connected', 'failed');
			var sd = connectionStatus.get(nodeId);
			if (sd) {
				if (sd.status === "testing") {
					testBtn.classList.add("busy");
				} else if (sd.status === "connected") {
					testBtn.classList.add("connected");
				} else if (sd.status === "failed" || sd.status === "cors_blocked") {
					testBtn.classList.add("failed");
				}
			}
		}
	}
	// 2. 更新全局 test-all 按钮
	var testAllBtn = document.querySelector(".test-all");
	if (testAllBtn && typeof getGroups === "function") {
		var allTestableIds = [];
		function collectTestable(ns) {
            ns.forEach(function(n) {
                var rcfg = resolveNodeConfig(n.id);

                if (rcfg && rcfg.baseUrl && rcfg.modelId && (rcfg.type === "chat" || rcfg.type === "embedding" || rcfg.type === "embed"))
                    allTestableIds.push(n.id);

                if (n.children)
                    collectTestable(n.children);
            });
        }
		collectTestable(getGroups());
		var hasTesting = false, hasFail = false, hasSuccess = false;
		allTestableIds.forEach(function(id) {
			var sd = connectionStatus.get(id);
			if (sd) {
				if (sd.status === "testing") hasTesting = true;
				else if (sd.status === "connected") hasSuccess = true;
				else if (sd.status === "failed" || sd.status === "cors_blocked") hasFail = true;
			}
		});
			testAllBtn.classList.remove("busy", "connected", "failed");
			testAllBtn.classList.add("test-connection");
			if (hasTesting) {
				testAllBtn.classList.add("busy");
			} else {
				if (hasFail && !hasSuccess) testAllBtn.classList.add("failed");
				else if (hasSuccess && !hasFail) testAllBtn.classList.add("connected");
			}
	}
	// 3. 级联更新所有祖先节点的 batch 测试按钮（检查全部可测子孙节点）
	var cur = nodeEl;
	while (cur) {
		var container = cur.parentElement;
		if (!container || !container.classList.contains('children')) break;
		var parentEl = container.closest('.one.endpoint');
		if (!parentEl) break;
		var pNode = getNode(parentEl.dataset.nodeId);
		if (pNode) {
			var tids = [];
			(function collect(nds) {
				nds.forEach(function(n) {
					var cfg = resolveNodeConfig(n.id);
					if (cfg && cfg.baseUrl && cfg.modelId && (cfg.type === "chat" || cfg.type === "embedding" || cfg.type === "embed"))
						tids.push(n.id);
					if (n.children) collect(n.children);
				});
			})([pNode]);
			var anyTesting = false, anyFail = false, anySuccess = false;
			tids.forEach(function(id) {
				var cs = connectionStatus.get(id);
				if (cs) {
					if (cs.status === "testing") anyTesting = true;
					else if (cs.status === "connected") anySuccess = true;
					else if (cs.status === "failed" || cs.status === "cors_blocked") anyFail = true;
				}
			});
			var parentBtn = parentEl.querySelector('.test-connection');
			if (parentBtn) {
				parentBtn.classList.remove("busy", "connected", "failed");
				if (anyTesting) {
					parentBtn.classList.add("busy");
				} else {
					if (anyFail && !anySuccess) parentBtn.classList.add("failed");
					else if (anySuccess && !anyFail) parentBtn.classList.add("connected");
				}
			}
		}
		cur = parentEl;
	}

}
