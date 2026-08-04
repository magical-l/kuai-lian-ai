// ========== Endpoint Tree Functions ==========
const collapsedEndpoints = new Set();
var activeTypeFilters = new Set();

function isEndpointTestable(nodeId) {
	var cfg = resolveNodeConfig(nodeId);
	if (!cfg || !cfg.baseUrl || cfg.key === undefined || cfg.key === null || !cfg.modelId)
		return false;
	return cfg.type === 'chat' || cfg.type === 'embedding' || cfg.type === 'embed' || cfg.type === 'tts' || cfg.type === 'asr';
}

function setEmptyStateVisibility(show) {
	var aside = document.querySelector('aside.endpoint.list');
	if (!aside) return;
	// 由 CSS :has() 自动控制显隐
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
	showEditGroupDialog(null, nodeId, async function(data) {
		var newNode = await addNode(nodeId, data);

		if (newNode) {
			var currentNodeEl = nodeEl;
			var existingNodeEl = null;
			if (typeof nodeEl.isConnected === 'boolean') {
				currentNodeEl = document.querySelector(".one.endpoint[data-node-id=\"" + nodeId + "\"]");
				if (!currentNodeEl) {
					await refreshUI();
					updateEmptyState();
					return;
				}
				existingNodeEl = currentNodeEl.querySelector(".one.endpoint[data-node-id=\"" + newNode.id + "\"]");
			}

			if (!existingNodeEl) {
				var childrenOl = currentNodeEl.querySelector('details > ol.children');
				if (!childrenOl) {
					childrenOl = document.createElement('ol');
					childrenOl.className = 'children';
					currentNodeEl.querySelector('details').appendChild(childrenOl);
				}
				childrenOl.appendChild(buildEndpointNodeEl(newNode));
				currentNodeEl.classList.remove('compact');
				currentNodeEl.querySelector('.name').classList.add('has-children');
				// 展开父节点以便看到新子节点
				var detailsEl = currentNodeEl.querySelector('details');
				if (detailsEl) detailsEl.open = true;
				if (typeof updateEndpointTestUI === 'function') updateEndpointTestUI(newNode.id);
			}
			applyEndpointFilter();
		}
		await refreshUI({ skipEndpointTree: true });
		updateEmptyState();
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
	var nodeEl = btn.closest('.one.endpoint');
	var nodeId = nodeEl.dataset.nodeId;
	var cloned = await cloneNode(nodeId);
	if (cloned) {
		// 在原始节点后插入克隆 DOM
		nodeEl.parentNode.insertBefore(buildEndpointNodeEl(cloned), nodeEl.nextSibling);
	}
	await refreshUI({ skipEndpointTree: true });
	updateEmptyState();
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

function bindEndpointNodeDragEvents(nodeEl) {
	nodeEl.addEventListener("dragover", e => handleNodeDragover(e, e.currentTarget));
	nodeEl.addEventListener("dragleave", e => handleNodeDragleave(e.currentTarget));
	nodeEl.addEventListener("drop", e => handleNodeDrop(e, e.currentTarget));
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

/**
 * 从数据节点构建完整的 DOM 元素（含子节点递归），
 * 供单点增/改/克隆操作直接插入，避免全量重绘。
 */
function buildEndpointNodeEl(node) {
	var hasChildren = node.children && node.children.length > 0;
	var isCollapsed = collapsedEndpoints.has(node.id);
	var hasContent = hasChildren;
	var nodeEl = fromTemplate("one-endpoint", "li");
	if (!hasChildren) nodeEl.classList.add("compact");
	nodeEl.dataset.nodeId = node.id;
	nodeEl.dataset.nodeIndex = 0;
	var summaryEl = nodeEl.querySelector("details > summary");
	var dragHandle = nodeEl.querySelector(".handle");
	dragHandle.title = "拖动排序";
	var detailsEl = nodeEl.querySelector("details");
	detailsEl.open = hasContent && !isCollapsed;
	var nameSpan = nodeEl.querySelector(".name");
	var rcfg = resolveNodeConfig(node.id);
	nameSpan.textContent = node.name;
	var remEl = nodeEl.querySelector(".remark");
	if (remEl) remEl.textContent = node.remark ? " " + node.remark : "";
	var typeEl = nodeEl.querySelector(".endpoint-type");

	if (typeEl) {
		var type = rcfg ? rcfg.type : "chat";
		if (type === "chat") {
			typeEl.classList.add("chat");
		} else if (type === "embedding") {
			typeEl.classList.add("digits");
		} else if (type === "image" || type === "image-generation") {
			typeEl.classList.add("palette");
		} else if (type === "video" || type === "video-generation") {
			typeEl.classList.add("video");
		} else if (type === "reranking") {
			typeEl.classList.add("chart");
		} else if (type === "tts") {
			typeEl.classList.add("speaker");
		} else if (type === "asr") {
			typeEl.classList.add("mic");
		}
	}

	var tooltipId = "tooltip-" + node.id;
	var tooltipHTML = buildTooltipHTML(node, rcfg, node.name);
	summaryEl._tooltip = createTooltip(tooltipId, nameSpan, tooltipHTML);
	var opListEl = nodeEl.querySelector(".op");
	var addChildBtn = opListEl.querySelector(".add-child");
	detailsEl.addEventListener("toggle", e => handleDetailsToggle(e.currentTarget));
	summaryEl.addEventListener("mouseover", e => handleSummaryTooltipMouseover(e, e.currentTarget));
	summaryEl.addEventListener("mouseleave", e => handleSummaryTooltipMouseleave(e.currentTarget));
	summaryEl.addEventListener("click", e => handleSummaryTooltipClick(e.currentTarget));
	dragHandle.addEventListener("dragstart", e => handleDragStart(e, e.currentTarget));
	dragHandle.addEventListener("dragend", e => handleDragEnd(e.currentTarget));
	bindEndpointNodeDragEvents(nodeEl);

	addChildBtn.addEventListener("click", e => {
		e.stopPropagation();
		handleAddChildClick(e.currentTarget);
	});

	opListEl.querySelector(".test-connection").addEventListener("click", e => {
		e.stopPropagation();
		handleBatchTestClick(e.currentTarget);
	});

	opListEl.querySelector(".join-session input").addEventListener("change", e => {
		e.stopPropagation();
		handleJoinSessionChange(e.currentTarget);
	});

	opListEl.querySelector(".edit").addEventListener("click", e => {
		e.stopPropagation();
		handleEditNodeClick(e.currentTarget);
	});

	opListEl.querySelector(".duplicate").addEventListener("click", e => {
		e.stopPropagation();
		handleDuplicateNodeClick(e.currentTarget);
	});

	opListEl.querySelector(".remove").addEventListener("click", e => {
		e.stopPropagation();
		handleRemoveNodeClick(e.currentTarget);
	});

	function collectTestable(nds, out) {
		nds.forEach(function(n) {
			if (isEndpointTestable(n.id)) out.push(n.id);
			if (n.children) collectTestable(n.children, out);
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
			if (sd.status === "testing") hasTesting = true;
			if (sd.status === "connected") {} else if (sd.status === "testing") {} else {
				allOk = false;
				if (sd.status !== "disconnected") anyFailed = true;
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
		if (allTested && allOk) batchStatus = "connected";
		else if (anyFailed || (allTested && !allOk)) batchStatus = "failed";
	}

	var batchTestBtn = opListEl.querySelector(".test-connection");
	if (testableIds.length === 0) {
		batchTestBtn.classList.add("hidden");
	} else {
		batchTestBtn.classList.remove("busy", "connected", "failed");
		if (batchStatus) batchTestBtn.classList.add(batchStatus);
		if (hasTesting) batchTestBtn.classList.add("busy");

		if (!hasTesting) {
			var successCount = 0, failCount = 0, firstError = null;
			testableIds.forEach(function(id) {
				var sd = connectionStatus.get(id);
				if (sd) {
					if (sd.status === "connected") successCount++;
					else if (sd.status === "failed" || sd.status === "cors_blocked") {
						failCount++;
						if (!firstError && sd.error) firstError = sd.error;
					}
				}
			});

			var testSummary = "";
			if (failCount > 0) {
				testSummary = "✗ " + failCount + "个失败";
				if (firstError) testSummary += "：" + firstError;
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

	var joinBtn = opListEl.querySelector(".join-session");
	applyJoinBtnUI(joinBtn, node.id);

	if (hasChildren) {
		var childrenOl = document.createElement("ol");
		childrenOl.className = "children";
		node.children.forEach(function(c) {
			childrenOl.appendChild(buildEndpointNodeEl(c));
		});
		var detailsEl2 = nodeEl.querySelector("details");
		detailsEl2.appendChild(childrenOl);
	}

	if (node.children && node.children.length > 0) {
		nameSpan.classList.add("has-children");
	}

	return nodeEl;
}

function renderEndpointList(nodes, onNodeEdit, onNodeDelete, onReorderNodes, onTestConnection, onMoveNode) {
    var container = document.querySelector("aside.endpoint.list > ol");
    container.querySelectorAll("li").forEach(el => el.remove());

    function renderTreeNode(nodes, parentEl) {
        nodes.forEach(function(node) {
            var nodeEl = buildEndpointNodeEl(node);
            parentEl.appendChild(nodeEl);
        });
    }

    renderTreeNode(nodes, container);
    var testAllBtn = document.querySelector(".test-all");

    if (testAllBtn && typeof getGroups === "function") {
        var allTestableIds = [];

        function collectAllTestable(ns) {
            ns.forEach(function(n) {
                var cfg = resolveNodeConfig(n.id);

                if (isEndpointTestable(n.id))
                    allTestableIds.push(n.id);

                if (n.children)
                    collectAllTestable(n.children);
            });
        }

        collectAllTestable(getGroups());
        var hasTesting = false, hasFail = false, hasSuccess = false;

        allTestableIds.forEach(function(id) {
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

        testAllBtn.classList.remove("busy", "connected", "failed");
        testAllBtn.classList.add("test-connection");

        if (hasTesting) {
            testAllBtn.classList.add("busy");
        } else {
            if (hasFail)
                testAllBtn.classList.add("failed");
            else if (hasSuccess)
                testAllBtn.classList.add("connected");
        }
    }

    initEndpointFilter();
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
	var hiddenNodes = Array.from(document.querySelectorAll('aside.endpoint.list li.one.endpoint')).filter(function(node) {
		return node.classList.contains('hidden');
	}).length;
	var hasVisible = totalNodes - hiddenNodes;

	if (groups.length === 0) {
		// 没有建过任何端点：隐藏 ol，显示 empty-state
		emptyState.classList.remove('hidden');
		emptyHint.textContent = '目前还没有创建端点。';
		resetBtn.classList.add('hidden');
		addBtn.classList.remove('hidden');
	} else if (groups.length > 0 && hasVisible === 0 && activeTypeFilters.size > 0) {
		// 筛选后无结果：隐藏 ol，显示 empty-state
		emptyState.classList.remove('hidden');
		emptyHint.textContent = '没有符合筛选的端点。';
		resetBtn.classList.remove('hidden');
		addBtn.classList.add('hidden');
	} else {
		// 有可见端点：恢复 ol，隐藏 empty-state
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
	if (activeTypeFilters.size === 0) {
		items.forEach(function(li) {
			li.classList.remove('hidden');
		});
		return;
	}
	for (var i = items.length - 1; i >= 0; i--) {
		var li = items[i];
		var typeEl = li.querySelector('.endpoint-type');
		var type = '';
		if (typeEl) {
			if (typeEl.classList.contains('chat')) type = 'chat';
			else if (typeEl.classList.contains('digits')) type = 'embedding';
			else if (typeEl.classList.contains('palette')) type = 'image-generation';
			else if (typeEl.classList.contains('video')) type = 'video-generation';
			else if (typeEl.classList.contains('chart')) type = 'reranking';
			else if (typeEl.classList.contains('speaker')) type = 'tts';
			else if (typeEl.classList.contains('mic')) type = 'asr';
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
    var nodeEl = document.querySelector(".one.endpoint[data-node-id=\"" + nodeId + "\"]");

    if (nodeEl) {
        var testBtn = nodeEl.querySelector(".test-connection");

        if (testBtn) {
            testBtn.classList.remove("busy", "connected", "failed");
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

            testBtn.title = getConnectionStatusText(nodeId);
        }
    }

    var testAllBtn = document.querySelector(".test-all");

    if (testAllBtn && typeof getGroups === "function") {
        var allTestableIds = [];

        function collectTestable(ns) {
            ns.forEach(function(n) {
                var rcfg = resolveNodeConfig(n.id);

                if (isEndpointTestable(n.id))
                    allTestableIds.push(n.id);

                if (n.children)
                    collectTestable(n.children);
            });
        }

        collectTestable(getGroups());
        var hasTesting = false, hasFail = false, hasSuccess = false;
        var failCount = 0, successCount = 0;

        allTestableIds.forEach(function(id) {
            var sd = connectionStatus.get(id);

            if (sd) {
                if (sd.status === "testing")
                    hasTesting = true;
                else if (sd.status === "connected") {
                    hasSuccess = true;
                    successCount++;
                } else if (sd.status === "failed" || sd.status === "cors_blocked") {
                    hasFail = true;
                    failCount++;
                }
            }
        });

        testAllBtn.classList.remove("busy", "connected", "failed");
        testAllBtn.classList.add("test-connection");

        if (hasTesting) {
            testAllBtn.classList.add("busy");
        } else {
            if (hasFail)
                testAllBtn.classList.add("failed");
            else if (hasSuccess)
                testAllBtn.classList.add("connected");
        }

        var testAllSummary = [];

        if (successCount > 0)
            testAllSummary.push(successCount + "个成功");

        if (failCount > 0)
            testAllSummary.push(failCount + "个失败");

        testAllBtn.title = hasTesting ? "测试中..." : "全部测试 — " + (testAllSummary.length ? testAllSummary.join("，") : "无结果");
    }

    var cur = nodeEl;

    while (cur) {
        var container = cur.parentElement;

        if (!container || !container.classList.contains("children"))
            break;

        var parentEl = container.closest(".one.endpoint");

        if (!parentEl)
            break;

        var pNode = getNode(parentEl.dataset.nodeId);

        if (pNode) {
            var tids = [];

            (function collect(nds) {
                nds.forEach(function(n) {
                    var cfg = resolveNodeConfig(n.id);

                    if (isEndpointTestable(n.id))
                        tids.push(n.id);

                    if (n.children)
                        collect(n.children);
                });
            })([pNode]);

            var anyTesting = false, anyFail = false, anySuccess = false;
            var pFailCount = 0, pSuccessCount = 0;

            tids.forEach(function(id) {
                var cs = connectionStatus.get(id);

                if (cs) {
                    if (cs.status === "testing")
                        anyTesting = true;
                    else if (cs.status === "connected") {
                        anySuccess = true;
                        pSuccessCount++;
                    } else if (cs.status === "failed" || cs.status === "cors_blocked") {
                        anyFail = true;
                        pFailCount++;
                    }
                }
            });

            var parentBtn = parentEl.querySelector(".test-connection");

            if (parentBtn) {
                parentBtn.dataset.testableIds = JSON.stringify(tids);
                if (tids.length === 0)
                    parentBtn.classList.add("hidden");
                else
                    parentBtn.classList.remove("hidden");
                parentBtn.classList.remove("busy", "connected", "failed");

                if (anyTesting) {
                    parentBtn.classList.add("busy");
                } else {
                    if (anyFail)
                        parentBtn.classList.add("failed");
                    else if (anySuccess)
                        parentBtn.classList.add("connected");
                }

                if (tids.length === 1 && tids[0] === parentEl.dataset.nodeId) {
                    parentBtn.title = getConnectionStatusText(parentEl.dataset.nodeId);
                } else {
                    var pStats = [];

                    if (pSuccessCount > 0)
                        pStats.push(pSuccessCount + "个成功");

                    if (pFailCount > 0)
                        pStats.push(pFailCount + "个失败");

                    parentBtn.title = anyTesting ? "测试中..." : "测试连接（含" + tids.length + "个端点） — " + (pStats.length ? pStats.join("，") : "无结果");
                }
            }
        }

        cur = parentEl;
    }
}
