// ========== Endpoint Tree Functions ==========
const collapsedEndpoints = new Set();

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
		var toggle = $('.expand', el);
		var content = $('.children', el);
		if (content) content.style.display = 'none';
		if (toggle) toggle.textContent = '▶';
	});
}

function renderEndpointList(nodes, onNodeEdit, onNodeDelete, onReorderNodes, onTestConnection, onMoveNode) {
    var container = document.querySelector("aside.endpoint.list > ol");

    container.querySelectorAll('li').forEach(el => el.remove());

    function renderTreeNode(nodes, parentEl) {
        nodes.forEach(function(node, index) {
            var hasChildren = node.children && node.children.length > 0;
            var isCollapsed = collapsedEndpoints.has(node.id);
            var hasContent = hasChildren;
            var nodeEl = mk("li", "one endpoint" + (hasChildren ? "" : " compact"));
            nodeEl.dataset.nodeId = node.id;
            nodeEl.dataset.nodeIndex = index;
            var headerEl = mk("header", "flex items-go-x items-y-near-center");
            var dragHandle = mk("span", "handle drag btn , square , flex items-go-x");
            dragHandle.innerHTML = SVG.drag(14);
            dragHandle.title = "拖动排序";
            dragHandle.draggable = true;

            dragHandle.on("dragstart", function(e) {
                e.dataTransfer.setData("text/plain", node.id);
                e.dataTransfer.effectAllowed = "move";
                nodeEl.classList.add("dragging");
            });

            dragHandle.on("dragend", function() {
                nodeEl.classList.remove("dragging");

                $$(".one.endpoint", container).forEach(function(el) {
                    el.classList.remove("drag-over", "drag-over-child", "drag-over-before", "drag-over-after");
                });
            });

            var toggleSpan = mk("span", "expand btn , square , ▶ icon-only");
            toggleSpan.textContent = isCollapsed || !hasContent ? "▶" : "▼";

            if (!hasContent)
                toggleSpan.style.visibility = "hidden";

            toggleSpan.on("click", function(e) {
                e.stopPropagation();
                var ct = nodeEl.querySelector(".children");

                if (!ct)
                    return;

                if (ct.style.display === "none") {
                    ct.style.display = "";
                    toggleSpan.textContent = "▼";
                    collapsedEndpoints["delete"](node.id);
                } else {
                    ct.style.display = "none";
                    toggleSpan.textContent = "▶";
                    collapsedEndpoints.add(node.id);
                }
            });

            var nameSpan = mk("span", "name");
            var rcfg = resolveNodeConfig(node.id);
            nameSpan.textContent = node.name;

            var tooltipId = "tooltip-" + node.id;
            var tooltipHTML = buildTooltipHTML(node, rcfg, node.name);
            var tooltip = createTooltip(tooltipId, tooltipHTML);

            headerEl.on("mouseover", function(e) {
                if (actionsEl.contains(e.target)) {
                    tooltip.hide();
                    return;
                }
                tooltip.show(nameSpan);
            });
            headerEl.on("mouseleave", function() {
                tooltip.hide();
            });
            headerEl.on("click", function() {
                tooltip.hide();
            });

            var actionsEl = mk("div", "actions , flex items-go-x");
            var addChildBtn = mk("button", "add-child btn , square");
            addChildBtn.textContent = "+";
            addChildBtn.title = "添加子节点";

            addChildBtn.on("click", function(e) {
                e.stopPropagation();

                showEditGroupDialog(null, node.id, function(data) {
                    addNode(node.id, data).then(function() {
                        refreshUI();
                    });
                });
            });

            function isNodeTestable(n) {
                var cfg = resolveNodeConfig(n.id);
                if (!cfg || !cfg.baseUrl || cfg.key === undefined || cfg.key === null || !cfg.modelId) return false;
                var mtype = detectModelType(cfg.modelId);
                return mtype === 'chat' || mtype === 'embedding';
            }

            function collectTestable(nds, out) {
                nds.forEach(function(n) {
                    if (isNodeTestable(n))
                        out.push(n.id);

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

            var batchTestBtn = null;

            if (testableIds.length > 0) {
                batchTestBtn = mk("button");
                batchTestBtn.className = "test-connection square" + (batchStatus ? " " + batchStatus : "");
                batchTestBtn.innerHTML = `<span>🔗</span>`;

                if (hasTesting) {
                    batchTestBtn.classList.add("testing");
                    $("span", batchTestBtn).classList.add("spin");
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

                batchTestBtn.on("click", function(e) {
                    e.stopPropagation();

                    if (onTestConnection) {
                        testableIds.forEach(function(id) {
                            onTestConnection(id);
                        });
                    }
                    batchTestBtn.classList.add("testing");
                    var sp = batchTestBtn.querySelector("span");
                    if (sp) sp.classList.add("spin");
                });
            }

            var joinBtn = null;

            if (isSelfTestable) {
                joinBtn = mk("button", "join-session btn , square");
                joinBtn.innerHTML = SVG.bubble(12);
                applyJoinBtnUI(joinBtn, node.id);

                joinBtn.on("click", function(e) {
                    e.stopPropagation();
                    var eid = node.id;

                    if (selectedEndpoints.includes(eid)) {
                        selectedEndpoints = selectedEndpoints.filter(function(x) {
                            return x !== eid;
                        });
                    } else {
                        selectedEndpoints.push(eid);
                    }

                    saveDefaultSelectedEndpoints(selectedEndpoints);
                    renderSelectedEndpoints(getGroups(), selectedEndpoints, false);
                    applyJoinBtnUI(joinBtn, node.id);
                });
            }

            var editBtn = mk("button", "edit btn , square");
            editBtn.innerHTML = SVG.edit(12);
            editBtn.title = "编辑节点";

            editBtn.on("click", function(e) {
                e.stopPropagation();
                onNodeEdit(node.id);
            });

            var deleteBtn = mk("button", "remove btn , danger , square");
            deleteBtn.innerHTML = SVG.del(12);
            deleteBtn.title = "删除节点及其子节点";

            deleteBtn.on("click", function(e) {
                e.stopPropagation();

                confirmAction("确定删除节点「" + node.name + "」及其所有子节点和端点？", function() {
                    onNodeDelete(node.id);
                });
            });

            actionsEl.addChild(addChildBtn);

            if (batchTestBtn)
                actionsEl.addChild(batchTestBtn);

            if (joinBtn)
                actionsEl.addChild(joinBtn);

            actionsEl.addChild(editBtn);
            actionsEl.addChild(deleteBtn);
            headerEl.addChild(dragHandle);
            headerEl.addChild(toggleSpan);
            headerEl.addChild(nameSpan);
            headerEl.addChild(actionsEl);
            if (node.remark) {
                var remSpan = document.createElement("span");
                remSpan.className = "remark";
                remSpan.textContent = " " + node.remark;
                headerEl.insertBefore(remSpan, actionsEl);
            }
            nodeEl.addChild(headerEl);

            nodeEl.on("dragover", function(e) {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = "move";
                var draggingEl = $(".dragging", container);

                if (!draggingEl || draggingEl === nodeEl)
                    return;

                var header = $("header", nodeEl);
                var headerRect = header.getBoundingClientRect();
                nodeEl.classList.remove("drag-over-before", "drag-over-after", "drag-over-child");

                if (e.clientY >= headerRect.top && e.clientY <= headerRect.bottom) {
                    if (e.clientY < headerRect.top + headerRect.height / 2) {
                        nodeEl.classList.add("drag-over-before");
                    } else {
                        nodeEl.classList.add("drag-over-child");
                    }
                } else {
                    nodeEl.classList.add("drag-over-child");
                }
            });

            nodeEl.on("dragleave", function() {
                nodeEl.classList.remove("drag-over-before", "drag-over-after", "drag-over-child");
            });

            nodeEl.on("drop", function(e) {
                e.preventDefault();
                e.stopPropagation();
                var willMoveAsChild = nodeEl.classList.contains("drag-over-child");
                nodeEl.classList.remove("drag-over-before", "drag-over-after", "drag-over-child");
                var rawData = e.dataTransfer.getData("text/plain");
                var draggedId = rawData;

                if (!draggedId || draggedId === node.id)
                    return;

                if (willMoveAsChild) {
                    if (onMoveNode)
                        onMoveNode(draggedId, node.id);
                } else {
                    if (onReorderNodes)
                        onReorderNodes(draggedId, node.id, true);
                }
            });

            if (hasContent) {
                var contentEl = mk("div", "children");
                contentEl.style.gap = "var(--space-1)";

                if (isCollapsed) {
                    contentEl.style.display = "none";
                }

                renderTreeNode(node.children, contentEl);
                nodeEl.addChild(contentEl);
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

                if (rcfg && rcfg.baseUrl && rcfg.modelId && detectModelType(rcfg.modelId) === 'chat' || detectModelType(rcfg.modelId) === 'embedding')
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
        var spanEl = $("span", testAllBtn);

        if (hasTesting) {
            testAllBtn.classList.add("testing");

            if (spanEl)
                spanEl.classList.add("spin");
        } else {
            if (spanEl)
                spanEl.classList.remove("spin");

            if (hasFail && !hasSuccess)
                testAllBtn.classList.add("failed");
            else if (hasSuccess && !hasFail)
                testAllBtn.classList.add("connected");
        }
    }
}

function updateEndpointTestUI(nodeId) {
	// 1. 更新单个节点的测试按钮
	var nodeEl = document.querySelector('.one.endpoint[data-node-id="' + nodeId + '"]');
	if (nodeEl) {
		var testBtn = nodeEl.querySelector('.test-connection');
		if (testBtn) {
			testBtn.className = "test-connection square";
			var spanEl = testBtn.querySelector('span');
			if (spanEl) spanEl.classList.remove('spin', 'testing');
			var sd = connectionStatus.get(nodeId);
			if (sd) {
				if (sd.status === "testing") {
					testBtn.classList.add("testing");
					if (spanEl) spanEl.classList.add('spin');
					testBtn.title = "测试中...";
				} else if (sd.status === "connected") {
					testBtn.classList.add("connected");
					testBtn.title = getConnectionStatusText ? getConnectionStatusText(nodeId) : "✓ 成功";
				} else if (sd.status === "failed" || sd.status === "cors_blocked") {
					testBtn.classList.add("failed");
					testBtn.title = getConnectionStatusText ? getConnectionStatusText(nodeId) : (sd.error || "✗ 失败");
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
				if (rcfg && rcfg.baseUrl && rcfg.modelId && (detectModelType(rcfg.modelId) === 'chat' || detectModelType(rcfg.modelId) === 'embedding'))
					allTestableIds.push(n.id);
				if (n.children) collectTestable(n.children);
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
		testAllBtn.classList.remove("testing", "connected", "failed");
		testAllBtn.classList.add("test-connection");
		var spanEl = testAllBtn.querySelector("span");
		if (spanEl) spanEl.classList.remove("spin");
		if (hasTesting) {
			testAllBtn.classList.add("testing");
			if (spanEl) spanEl.classList.add("spin");
		} else {
			if (hasFail && !hasSuccess) testAllBtn.classList.add("failed");
			else if (hasSuccess && !hasFail) testAllBtn.classList.add("connected");
		}
	}
	// 3. 更新父级 batch 测试按钮
	var container = nodeEl ? nodeEl.parentElement : null;
	if (container && container.classList.contains('children')) {
		var parentEl = container.closest('.one.endpoint');
		if (parentEl) {
			var parentBtn = parentEl.querySelector('.test-connection');
			if (parentBtn) {
				var childNodes = container.querySelectorAll(':scope > .one.endpoint');
				var anyTesting = false, anyFail = false, anySuccess = false;
				childNodes.forEach(function(child) {
					var cs = connectionStatus.get(child.dataset.nodeId);
					if (cs) {
						if (cs.status === "testing") anyTesting = true;
						else if (cs.status === "connected") anySuccess = true;
						else if (cs.status === "failed" || cs.status === "cors_blocked") anyFail = true;
					}
				});
				if (!anyTesting) {
					parentBtn.classList.remove("testing");
					var s = parentBtn.querySelector('span');
					if (s) s.classList.remove("spin");
					parentBtn.classList.remove("connected", "failed");
					if (anyFail && !anySuccess) parentBtn.classList.add("failed");
					else if (anySuccess && !anyFail) parentBtn.classList.add("connected");
				}
			}
		}
	}
}
