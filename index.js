const itemMap = require('./items.json');

module.exports = function AutoUpgrader(mod) {
    mod.dispatch.addDefinition('S_RESULT_EVOLUTION', 999, __dirname + '/S_RESULT_EVOLUTION.999.def', true);
    
    let state = {
        enabled: false,
        processing: false,
        waitingForInventory: false,
        contractCreated: false,
        shouldReadInventory: false,
        upgradeAllMode: false,
        contractId: null,
        targetItems: [],
        targetItemIds: [],
        targetUpgrades: 0,
        upgradesCompleted: 0,
        lastProcessedDbid: null,
        currentMoney: 0n,
        accumulatedItems: [],
        packetTimer: null,
        lastPacketTime: 0,
        checkMode: false,
        checkItemType: null,
        checkTargetTier: null,
        hooksInitialized: false
    };
    
    const PACKET_DELAY = 200;
    const hooks = {};
    
    const tierToT1 = {
        't1': 1,
        't2': 2,
        't3': 4,
        't4': 8,
        't5': 16,
        'ext1': 32,
        'ext2': 64,
        'ext3': 128,
        'ext4': 256,
        'ext5': 512
    };
    
    function getBaseItemType(itemType) {
        return itemType.startsWith('ex_') ? itemType.substring(3) : itemType;
    }
    
    function isExItemType(itemType) {
        return itemType.startsWith('ex_');
    }
    
    function getAllItemIds(itemType) {
        return itemMap[itemType] ? Object.values(itemMap[itemType]) : [];
    }
    
    function calculateUpgradeNeeds(targetTier, itemCounts, itemType) {
        let actualTargetTier = targetTier;
        if (isExItemType(itemType)) {
            actualTargetTier = targetTier.replace('t', 'ext');
        }
        
        if (isExItemType(itemType)) {
            const baseItemType = getBaseItemType(itemType);
            const targetLevel = parseInt(actualTargetTier.replace('ext', ''));
            const t1NeededForTarget = Math.pow(2, targetLevel) * 16; // Convert EXT target to T1s
            
            // Calculate total T1 equivalent including ALL partial materials
            let totalT1Equivalent = 0;
            
            // Base type materials (convert everything to T1 equivalent)
            const baseT5Count = itemCounts[`${baseItemType}_t5`] || 0;
            totalT1Equivalent += baseT5Count * 16;
            
            const t4Count = itemCounts[`${baseItemType}_t4`] || 0;
            totalT1Equivalent += t4Count * 8;
            
            const t3Count = itemCounts[`${baseItemType}_t3`] || 0;
            totalT1Equivalent += t3Count * 4;
            
            const t2Count = itemCounts[`${baseItemType}_t2`] || 0;
            totalT1Equivalent += t2Count * 2;
            
            const t1Count = itemCounts[`${baseItemType}_t1`] || 0;
            totalT1Equivalent += t1Count * 1;
            
            // Add existing EXT items (convert to T1 equivalent)
            for (let extLevel = 1; extLevel < targetLevel; extLevel++) {
                const extTier = `ext${extLevel}`;
                const extCount = itemCounts[extTier] || 0;
                if (extCount > 0) {
                    const t1Worth = extCount * Math.pow(2, extLevel) * 16;
                    totalT1Equivalent += t1Worth;
                }
            }
            
            const displayTier = actualTargetTier.toUpperCase();
            
            if (totalT1Equivalent >= t1NeededForTarget) {
                const excess = totalT1Equivalent - t1NeededForTarget;
                const canMake = Math.floor(totalT1Equivalent / t1NeededForTarget);
                return {
                    canUpgrade: true,
                    message: `[V] You can make ${canMake}x ${displayTier}! You have ${totalT1Equivalent} T1 equivalent, need ${t1NeededForTarget}.${excess > 0 ? ` Excess: ${excess} T1 equivalent.` : ''}`
                };
            } else {
                const needed = t1NeededForTarget - totalT1Equivalent;
                return {
                    canUpgrade: false,
                    message: `[X] You need ${needed} more T1s to make ${displayTier}. You have ${totalT1Equivalent} T1 equivalent, need ${t1NeededForTarget}.`
                };
            }
        } else {
            const t1NeededForTarget = tierToT1[actualTargetTier];
            let totalT1Equivalent = 0;
            
            for (const tier in tierToT1) {
                if (tierToT1[tier] < t1NeededForTarget && tier.startsWith('t')) {
                    const count = itemCounts[tier] || 0;
                    const t1Value = count * tierToT1[tier];
                    totalT1Equivalent += t1Value;
                }
            }
            
            const displayTier = targetTier.toUpperCase();
            
            if (totalT1Equivalent >= t1NeededForTarget) {
                const excess = totalT1Equivalent - t1NeededForTarget;
                return {
                    canUpgrade: true,
                    message: `[V] You can upgrade to ${displayTier}! You have ${totalT1Equivalent} T1 equivalent, need ${t1NeededForTarget}.${excess > 0 ? ` Excess: ${excess} T1 equivalent.` : ''}`
                };
            } else {
                const needed = t1NeededForTarget - totalT1Equivalent;
                return {
                    canUpgrade: false,
                    message: `[X] You need ${needed} more T1s to upgrade to ${displayTier}. You have ${totalT1Equivalent} T1 equivalent, need ${t1NeededForTarget}.`
                };
            }
        }
    }
    
    function processCheckInventory() {
        if (!state.checkMode) return;
        
        const currentItems = combineItems().filter(item => {
            if (isExItemType(state.checkItemType)) {
                const baseItemType = getBaseItemType(state.checkItemType);
                const exItemIds = Object.values(itemMap[state.checkItemType] || {});
                const baseItemIds = Object.values(itemMap[baseItemType] || {});
                return exItemIds.includes(item.id) || baseItemIds.includes(item.id);
            } else {
                return Object.values(itemMap[state.checkItemType] || {}).includes(item.id);
            }
        });
        
        const itemCounts = {};
        currentItems.forEach(item => {
            let found = false;
            
            if (isExItemType(state.checkItemType)) {
                for (const [tier, itemId] of Object.entries(itemMap[state.checkItemType] || {})) {
                    if (item.id === itemId) {
                        const exTier = tier.replace('t', 'ext');
                        itemCounts[exTier] = (itemCounts[exTier] || 0) + (item.amount || 1);
                        found = true;
                        break;
                    }
                }
                
                if (!found) {
                    const baseItemType = getBaseItemType(state.checkItemType);
                    for (const [tier, itemId] of Object.entries(itemMap[baseItemType] || {})) {
                        if (item.id === itemId) {
                            itemCounts[`${baseItemType}_${tier}`] = (itemCounts[`${baseItemType}_${tier}`] || 0) + (item.amount || 1);
                            found = true;
                            break;
                        }
                    }
                }
            } else {
                for (const [tier, itemId] of Object.entries(itemMap[state.checkItemType] || {})) {
                    if (item.id === itemId) {
                        itemCounts[tier] = (itemCounts[tier] || 0) + (item.amount || 1);
                        found = true;
                        break;
                    }
                }
            }
        });
        
        const result = calculateUpgradeNeeds(state.checkTargetTier, itemCounts, state.checkItemType);
        mod.command.message(result.message);
        
        state.checkMode = false;
        state.checkItemType = null;
        state.checkTargetTier = null;
    }
    
    function resetState() {
        Object.assign(state, {
            enabled: false,
            processing: false,
            waitingForInventory: false,
            contractCreated: false,
            shouldReadInventory: false,
            upgradeAllMode: false,
            contractId: null,
            targetItems: [],
            targetUpgrades: 0,
            upgradesCompleted: 0,
            lastProcessedDbid: null,
            currentMoney: 0n,
            accumulatedItems: [],
            checkMode: false,
            checkItemType: null,
            checkTargetTier: null
        });
        
        if (state.packetTimer) {
            clearTimeout(state.packetTimer);
            state.packetTimer = null;
        }
    }
    
    function cleanup() {
        resetState();
        
        if (state.contractId) {
            try {
                mod.send('C_CANCEL_CONTRACT', 1, { type: 89 });
            } catch (error) {}
        }
        
        Object.values(hooks).forEach(hook => hook && mod.unhook(hook));
        Object.keys(hooks).forEach(key => hooks[key] = null);
        state.hooksInitialized = false;
    }

    function combineItems() {
        if (!state.accumulatedItems.length) return [];
        
        const itemMap = new Map();
        state.accumulatedItems.forEach(item => {
            if (itemMap.has(item.dbid)) {
                itemMap.get(item.dbid).amount += item.amount;
            } else {
                itemMap.set(item.dbid, { ...item });
            }
        });
        
        state.accumulatedItems = [];
        return Array.from(itemMap.values());
    }

    function reorderItemsForUpgrade() {
        if (!state.upgradeAllMode) return;
        
        const itemsByIdMap = {};
        state.targetItems.forEach(item => {
            (itemsByIdMap[item.id] = itemsByIdMap[item.id] || []).push(item);
        });
        
        const sortedIds = [...state.targetItemIds].sort((a, b) => a - b);
        const priorityId = sortedIds.find(id => itemsByIdMap[id]?.length >= 2);
        
        if (priorityId) {
            const priorityItems = itemsByIdMap[priorityId];
            const otherItems = state.targetItems.filter(item => item.id !== priorityId);
            state.targetItems = [...priorityItems, ...otherItems];
        } else {
            mod.command.message(`All upgrades completed! ${state.targetItems.length} items remaining`);
            closeContract();
            return false;
        }
        return true;
    }

    function processPackets() {
        if (state.checkMode) {
            processCheckInventory();
            return;
        }
        
        if (!state.enabled || !state.shouldReadInventory) return;
        
        const currentItems = combineItems().filter(item => state.targetItemIds.includes(item.id));
        currentItems.sort((a, b) => a.id - b.id);
        
        if (!currentItems.length) return;
        
        state.targetItems = currentItems;
        
        if (state.waitingForInventory) {
            state.waitingForInventory = false;
            state.shouldReadInventory = false;
            
            if (state.targetItems.length >= 2) {
                mod.command.message(`Found ${state.targetItems.length} items, starting...`);
                
                if (state.upgradeAllMode && !reorderItemsForUpgrade()) return;
                
                startUpgrade();
            } else {
                mod.command.message('Need at least 2 items');
                state.enabled = false;
            }
        } else if (!state.processing) {
            checkContinuation();
        }
    }

    function initializeHooks() {
        if (state.hooksInitialized) return;
        
        if (!hooks.itemlist) {
            hooks.itemlist = mod.hook('S_ITEMLIST', 4, (event) => {
                if (event.gameId !== mod.game.me.gameId) return;
                
                if (state.checkMode) {
                    state.currentMoney = BigInt(event.money);
                    
                    const packetItems = [];
                    const items = Array.isArray(event.items) ? event.items : Object.values(event.items || {});
                    
                    items.forEach(item => {
                        if (item) {
                            if (isExItemType(state.checkItemType)) {
                                const baseItemType = getBaseItemType(state.checkItemType);
                                const exItemIds = Object.values(itemMap[state.checkItemType] || {});
                                const baseItemIds = Object.values(itemMap[baseItemType] || {});
                                
                                if (exItemIds.includes(item.id) || baseItemIds.includes(item.id)) {
                                    packetItems.push({
                                        dbid: item.dbid,
                                        amount: item.amount || 1,
                                        id: item.id
                                    });
                                }
                            } else {
                                const typeItemIds = Object.values(itemMap[state.checkItemType] || {});
                                if (typeItemIds.includes(item.id)) {
                                    packetItems.push({
                                        dbid: item.dbid,
                                        amount: item.amount || 1,
                                        id: item.id
                                    });
                                }
                            }
                        }
                    });
                    
                    state.accumulatedItems.push(...packetItems);
                    
                    if (state.packetTimer) clearTimeout(state.packetTimer);
                    
                    state.packetTimer = setTimeout(() => {
                        processPackets();
                        state.packetTimer = null;
                    }, PACKET_DELAY);
                    
                    state.lastPacketTime = Date.now();
                    return;
                }
                
                if (!state.enabled || !state.shouldReadInventory) return;
                
                state.currentMoney = BigInt(event.money);
                
                const packetItems = [];
                const items = Array.isArray(event.items) ? event.items : Object.values(event.items || {});
                
                items.forEach(item => {
                    if (item && state.targetItemIds.includes(item.id)) {
                        packetItems.push({
                            dbid: item.dbid,
                            amount: item.amount || 1,
                            id: item.id
                        });
                    }
                });
                
                state.accumulatedItems.push(...packetItems);
                
                if (state.packetTimer) clearTimeout(state.packetTimer);
                
                state.packetTimer = setTimeout(() => {
                    processPackets();
                    state.packetTimer = null;
                }, PACKET_DELAY);
                
                state.lastPacketTime = Date.now();
            });
        }
        
        if (!hooks.requestContract) {
            hooks.requestContract = mod.hook('S_REQUEST_CONTRACT', 1, (event) => {
                if (event.type === 89) {
                    state.contractId = event.id;
                    state.contractCreated = true;
                }
            });
        }
        
        if (!hooks.registerEvolution) {
            hooks.registerEvolution = mod.hook('S_REGISTER_EVOLUTION_ITEM', 3, (event) => {
                if (!state.enabled || !state.contractCreated || event.price === undefined) return;
                
                if (state.currentMoney < BigInt(event.price)) {
                    mod.command.message('No more money');
                    cleanup();
                }
            });
        }
        
        if (!hooks.resultEvolution) {
            hooks.resultEvolution = mod.hook('S_RESULT_EVOLUTION', 999, (event) => {
                const isOurUpgrade = state.enabled && state.contractCreated && 
                                   (event.contract === state.contractId || event.contract === 0) &&
                                   event.dbid !== state.lastProcessedDbid;
                
                if (isOurUpgrade) {
                    state.lastProcessedDbid = event.dbid;
                    
                    if (event.result === 1) {
                        state.upgradesCompleted++;
                    } else {
                        mod.command.message('Upgrade failed');
                    }
                    
                    state.processing = false;
                    state.shouldReadInventory = true;
                }
            });
        }
        
        state.hooksInitialized = true;
    }
    
    mod.command.add('upgrade', (arg1, arg2, arg3, arg4) => {
        if (arg1 === 'on') {
            if (!arg2 || !arg3) {
                mod.command.message('Usage: upgrade on [item_type] [tier|all] [count](optional)');
                return;
            }
            
            const itemType = arg2.toLowerCase();
            const tier = arg3.toLowerCase();
            const itemCount = arg4 ? parseInt(arg4) : null;
            
            if (tier === 'all') {
                if (!itemMap[itemType]) {
                    mod.command.message('Invalid item type');
                    return;
                }
                state.upgradeAllMode = true;
                state.targetItemIds = getAllItemIds(itemType);
            } else {
                if (!itemMap[itemType]?.[tier]) {
                    mod.command.message('Invalid item type or tier');
                    return;
                }
                state.upgradeAllMode = false;
                state.targetItemIds = [itemMap[itemType][tier]];
            }
            
            if (itemCount !== null && (isNaN(itemCount) || itemCount < 2 || itemCount % 2 !== 0)) {
                mod.command.message('Count must be even number >= 2');
                return;
            }
            
            if (!state.targetItemIds.length) {
                mod.command.message('Invalid item type');
                return;
            }
            
            initializeHooks();
            
            Object.assign(state, {
                enabled: true,
                processing: false,
                waitingForInventory: true,
                contractCreated: false,
                shouldReadInventory: true,
                lastProcessedDbid: null,
                targetItems: [],
                targetUpgrades: itemCount ? itemCount / 2 : null,
                upgradesCompleted: 0,
                currentMoney: 0n,
                accumulatedItems: [],
                checkMode: false,
                checkItemType: null,
                checkTargetTier: null
            });
            
            const modeText = state.upgradeAllMode ? 'all tiers' : tier;
            const countText = state.targetUpgrades ? `(${state.targetUpgrades} upgrades)` : '(all)';
            mod.command.message(`Upgrade enabled: ${itemType} ${modeText} ${countText}`);
            mod.command.message('Open inventory to start...');
            
        } else if (arg1 === 'off') {
            cleanup();
            mod.command.message('Upgrade disabled');
            
        } else if (arg1 === 'status') {
            mod.command.message(`Status: ${state.enabled ? 'ON' : 'OFF'} | Processing: ${state.processing} | Completed: ${state.upgradesCompleted}/${state.targetUpgrades || 'all'}`);
            
        } else if (arg1 === 'check') {
            const itemType = arg2;
            const tier = arg3;
            
            if (!itemType || !tier) {
                mod.command.message('Usage: upgrade check [item_type] [tier]');
                return;
            }
            
            if (!itemMap[itemType]) {
                mod.command.message('Invalid item type');
                return;
            }
            
            if (!['t1', 't2', 't3', 't4', 't5'].includes(tier)) {
                mod.command.message('Invalid tier');
                return;
            }
            
            if (!itemMap[itemType][tier]) {
                mod.command.message(`Tier ${tier} not found for item type ${itemType}`);
                return;
            }
            
            initializeHooks();
            
            state.checkMode = true;
            state.checkItemType = itemType;
            state.checkTargetTier = tier;
            state.accumulatedItems = [];
            
            mod.command.message('Open inventory to scan items...');
            
        } else {
            mod.command.message('Usage: upgrade [on|off|status|check]');
            mod.command.message('  upgrade on [type] [tier] [count] - Start upgrading');
            mod.command.message('  upgrade check [type] [tier] - Calculate upgrade needs');
            mod.command.message('  upgrade off - Stop upgrading');
            mod.command.message('  upgrade status - Show current status');
            mod.command.message('Types: halidom, relic, ex_halidom, ex_relic');
            mod.command.message('Tiers: t1-t5');
        }
    });
    
    function checkContinuation() {
        if (!state.enabled || state.processing) return;
        
        if (state.upgradeAllMode && !reorderItemsForUpgrade()) return;
        
        const maxUpgrades = Math.floor(state.targetItems.length / 2);
        const remainingUpgrades = state.targetUpgrades ? (state.targetUpgrades - state.upgradesCompleted) : maxUpgrades;
        const canContinue = state.targetItems.length >= 2 && remainingUpgrades > 0;
        
        if (canContinue) {
            state.shouldReadInventory = false;
            continueUpgrade();
        } else if (state.targetUpgrades && state.upgradesCompleted >= state.targetUpgrades) {
            mod.command.message(`All ${state.targetUpgrades} upgrades completed!`);
            closeContract();
        } else if (!state.targetUpgrades && state.targetItems.length < 2) {
            mod.command.message(`All upgrades completed!`);
            closeContract();
        }
    }
    
    function closeContract() {
        state.enabled = false;
        state.shouldReadInventory = false;
        state.upgradeAllMode = false;
        
        if (state.contractId) {
            try {
                mod.send('C_CANCEL_CONTRACT', 1, { type: 89 });
                state.contractId = null;
                state.contractCreated = false;
            } catch (error) {}
        }
    }
    
    function startUpgrade() {
        if (!state.enabled || state.processing || state.targetItems.length < 2) return;
        
        state.processing = true;
        
        if (!state.contractCreated) {
            state.contractId = null;
            mod.send('C_REQUEST_CONTRACT', 1, { type: 89 });
            
            setTimeout(() => {
                if (state.contractId) {
                    continueUpgrade();
                } else {
                    state.processing = false;
                    state.contractCreated = false;
                    setTimeout(() => state.enabled && startUpgrade(), 200);
                }
            }, 300);
        } else {
            continueUpgrade();
        }
    }
    
    function continueUpgrade() {
        if (!state.enabled || state.targetItems.length < 2 || !state.contractId) {
            state.processing = false;
            return;
        }
        
        const currentItem = state.targetItems[0];
        
        const sendPacket = (packetName, delay = 300) => {
            return new Promise((resolve) => {
                setTimeout(() => {
                    if (!state.enabled) {
                        state.processing = false;
                        resolve(false);
                        return;
                    }
                    
                    mod.send(packetName, 1, {
                        contract: state.contractId,
                        dbid: currentItem.dbid,
                        id: currentItem.id
                    });
                    resolve(true);
                }, delay);
            });
        };
        
        const finalTimeout = () => {
            setTimeout(() => {
                if (state.processing) {
                    state.processing = false;
                    if (state.enabled && state.targetItems.length >= 2) {
                        setTimeout(() => continueUpgrade(), 300);
                    }
                }
            }, 500);
        };
        
        try {
            mod.send('C_REGISTER_EVOLUTION_ITEM', 1, {
                contract: state.contractId,
                dbid: currentItem.dbid,
                id: currentItem.id
            });
            
            sendPacket('C_REQUEST_EVOLUTION')
                .then(success => success && sendPacket('C_START_EVOLUTION'))
                .then(success => success && finalTimeout())
                .catch(() => {
                    state.processing = false;
                });
                
        } catch (error) {
            state.processing = false;
        }
    }
    
    this.destructor = cleanup;
};