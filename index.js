const itemMap = require('./items.json');

module.exports = function AutoUpgrader(mod) {
    mod.dispatch.addDefinition('S_RESULT_EVOLUTION', 999, __dirname + '/S_RESULT_EVOLUTION.999.def', true);
    let contractId = null;
    let targetItems = [];
    let processing = false;
    let enabled = false;
    let waitingForInventory = false;
    let targetItemIds = [];
    let targetUpgrades = 0;
    let upgradesCompleted = 0;
    let contractCreated = false;
    let shouldReadInventory = false;
    let lastProcessedDbid = null;
    let currentMoney = 0n;
    let upgradeAllMode = false;
    
    let hooks = {
        itemlist: null,
        requestContract: null,
        registerEvolution: null,
        resultEvolution: null
    };
    
    function getAllItemIds(itemType) {
        if (itemMap[itemType]) {
            return Object.values(itemMap[itemType]);
        }
        return [];
    }
    
    function cleanup() {
        enabled = false;
        processing = false;
        waitingForInventory = false;
        contractCreated = false;
        shouldReadInventory = false;
        upgradeAllMode = false;
        
        if (contractId) {
            try {
                mod.send('C_CANCEL_CONTRACT', 1, { type: 89 });
            } catch (error) {
                mod.command.message('Error closing contract');
            }
            contractId = null;
        }
        
        if (hooks.itemlist) {
            mod.unhook(hooks.itemlist);
            hooks.itemlist = null;
        }
        if (hooks.requestContract) {
            mod.unhook(hooks.requestContract);
            hooks.requestContract = null;
        }
        if (hooks.registerEvolution) {
            mod.unhook(hooks.registerEvolution);
            hooks.registerEvolution = null;
        }
        if (hooks.resultEvolution) {
            mod.unhook(hooks.resultEvolution);
            hooks.resultEvolution = null;
        }
    }

    function initializeHooks() {
        if (!hooks.itemlist) {
            hooks.itemlist = mod.hook('S_ITEMLIST', 4, (event) => {
                if (event.gameId !== mod.game.me.gameId || !enabled || !shouldReadInventory) return;
                
                currentMoney = BigInt(event.money);
                
                let currentItems = [];
                
                if (event.items) {
                    let itemsToCheck = Array.isArray(event.items) ? event.items : Object.values(event.items);
                    
                    for (let item of itemsToCheck) {
                        if (item && targetItemIds.includes(item.id)) {
                            currentItems.push({
                                dbid: item.dbid,
                                amount: item.amount || 1,
                                id: item.id
                            });
                        }
                    }
                }
                
                currentItems.sort((a, b) => a.id - b.id);
                
                if (currentItems.length > 0) {
                    targetItems = currentItems;
                    
                    if (waitingForInventory) {
                        waitingForInventory = false;
                        shouldReadInventory = false;
                        
                        if (targetItems.length >= 2) {
                            mod.command.message(`Found ${targetItems.length} items, money: ${currentMoney.toString()}, starting...`);
                            startUpgradeProcess();
                        } else {
                            mod.command.message('Need at least 2 items');
                            enabled = false;
                        }
                    } else if (!processing) {
                        checkContinuation();
                    }
                }
            });
        }
        
        if (!hooks.requestContract) {
            hooks.requestContract = mod.hook('S_REQUEST_CONTRACT', 1, (event) => {
                if (event.type === 89) { 
                    contractId = event.id;
                    contractCreated = true;
                }
            });
        }
        
        if (!hooks.registerEvolution) {
            hooks.registerEvolution = mod.hook('S_REGISTER_EVOLUTION_ITEM', 3, (event) => {
                if (!enabled || !contractCreated) return;
                
                if (event.price !== undefined) {
                    const price = BigInt(event.price);
                    if (currentMoney < price) {
                        mod.command.message('No more money');
                        cleanup();
                        return;
                    }
                }
            });
        }
        
        if (!hooks.resultEvolution) {
            hooks.resultEvolution = mod.hook('S_RESULT_EVOLUTION', 999, (event) => {
                const isOurUpgrade = enabled && contractCreated && 
                               (event.contract === contractId || event.contract === 0) &&
                               event.dbid !== lastProcessedDbid;
                
                if (isOurUpgrade) {
                    lastProcessedDbid = event.dbid;
                    
                    if (event.result === 1) {
                        upgradesCompleted++;
                        mod.command.message(`Success! ${upgradesCompleted}/${targetUpgrades || 'all'} completed`);
                    } else {
                        mod.command.message('Upgrade failed');
                    }
                    
                    processing = false;
                    shouldReadInventory = true;
                }
            });
        }
    }
    
    mod.command.add('upgrade', (arg1, arg2, arg3, arg4) => {
        if (arg1 === 'on') {
            if (!arg2 || !arg3) {
                mod.command.message('Usage: upgrade on <item_type> <tier|all> [count]');
                mod.command.message('Example: upgrade on halidom t1 10');
                mod.command.message('Example: upgrade on halidom all');
                mod.command.message('Types: halidom, relic, ex_halidom, ex_relic | Tiers: t1-t5 or all');
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
                
                upgradeAllMode = true;
                targetItemIds = getAllItemIds(itemType);
                
                if (targetItemIds.length === 0) {
                    mod.command.message('Invalid item type for all mode');
                    return;
                }
            } else {
                if (!itemMap[itemType] || !itemMap[itemType][tier]) {
                    mod.command.message('Invalid item type or tier');
                    return;
                }
                
                upgradeAllMode = false;
                targetItemIds = [itemMap[itemType][tier]];
            }
            
            if (itemCount !== null && (isNaN(itemCount) || itemCount < 2 || itemCount % 2 !== 0)) {
                mod.command.message('Count must be even number >= 2');
                return;
            }
            
            initializeHooks();
            
            enabled = true;
            processing = false;
            waitingForInventory = true;
            contractCreated = false;
            shouldReadInventory = true;
            lastProcessedDbid = null;
            targetItems = [];
            targetUpgrades = itemCount ? itemCount / 2 : null;
            upgradesCompleted = 0;
            currentMoney = 0n;
            
            if (upgradeAllMode) {
                mod.command.message(`Upgrade enabled: ${itemType} all tiers ${targetUpgrades ? `(${targetUpgrades} upgrades)` : '(all)'}`);
            } else {
                mod.command.message(`Upgrade enabled: ${itemType} ${tier} ${targetUpgrades ? `(${targetUpgrades} upgrades)` : '(all)'}`);
            }
            mod.command.message('Open inventory to start...');
            
        } else if (arg1 === 'off') {
            cleanup();
            mod.command.message('Upgrade disabled');
            
        } else if (arg1 === 'status') {
            mod.command.message(`Status: ${enabled ? 'ON' : 'OFF'} | Processing: ${processing} | Completed: ${upgradesCompleted}/${targetUpgrades || 'all'} | Money: ${currentMoney.toString()}`);
        } else {
            mod.command.message('Usage: upgrade <on|off|status>');
        }
    });
    
    function checkContinuation() {
        if (!enabled || processing) return;
        
        if (upgradeAllMode) {
            const itemsByIdMap = {};
            for (let item of targetItems) {
                if (!itemsByIdMap[item.id]) {
                    itemsByIdMap[item.id] = [];
                }
                itemsByIdMap[item.id].push(item);
            }
            
            let foundPair = false;
            for (let id of targetItemIds) {
                if (itemsByIdMap[id] && itemsByIdMap[id].length >= 2) {
                    const priorityItems = itemsByIdMap[id];
                    const otherItems = targetItems.filter(item => item.id !== id);
                    targetItems = [...priorityItems, ...otherItems];
                    foundPair = true;
                    break;
                }
            }
            
            if (!foundPair) {
                mod.command.message(`All upgrades completed! ${targetItems.length} items remaining`);
                closeContract();
                return;
            }
        }
        
        const maxPossibleUpgrades = Math.floor(targetItems.length / 2);
        const remainingUpgrades = targetUpgrades ? (targetUpgrades - upgradesCompleted) : maxPossibleUpgrades;
        const canContinue = targetItems.length >= 2 && remainingUpgrades > 0;
        
        if (canContinue) {
            shouldReadInventory = false;
            continueUpgrade();
        } else if (targetUpgrades && upgradesCompleted >= targetUpgrades) {
            mod.command.message(`All ${targetUpgrades} upgrades completed!`);
            closeContract();
        } else if (!targetUpgrades && targetItems.length < 2) {
            mod.command.message(`All upgrades completed! ${targetItems.length} items remaining`);
            closeContract();
        }
    }
    
    function closeContract() {
        enabled = false;
        shouldReadInventory = false;
        upgradeAllMode = false;
        if (contractId) {
            try {
                mod.send('C_CANCEL_CONTRACT', 1, { type: 89 });
                contractId = null;
                contractCreated = false;
            } catch (error) {
                mod.command.message('Error closing contract');
            }
        }
    }
    
    function startUpgradeProcess() {
        if (!enabled || processing || targetItems.length < 2) return;
        
        processing = true;
        
        if (!contractCreated) {
            contractId = null;
            mod.send('C_REQUEST_CONTRACT', 1, { type: 89 });
            
            setTimeout(() => {
                if (contractId) {
                    continueUpgrade();
                } else {
                    processing = false;
                    contractCreated = false;
                    setTimeout(() => {
                        if (enabled) startUpgradeProcess();
                    }, 500);
                }
            }, 1000);
        } else {
            continueUpgrade();
        }
    }
    
    function continueUpgrade() {
        if (!enabled || targetItems.length < 2 || !contractId) {
            processing = false;
            return;
        }
        
        const currentItem = targetItems[0];
        
        try {
            mod.send('C_REGISTER_EVOLUTION_ITEM', 1, {
                contract: contractId,
                dbid: currentItem.dbid,
                id: currentItem.id
            });
            
            setTimeout(() => {
                if (!enabled) {
                    processing = false;
                    return;
                }
                
                mod.send('C_REQUEST_EVOLUTION', 1, {
                    contract: contractId,
                    dbid: currentItem.dbid,
                    id: currentItem.id
                });
                
                setTimeout(() => {
                    if (!enabled) {
                        processing = false;
                        return;
                    }
                    
                    mod.send('C_START_EVOLUTION', 1, {
                        contract: contractId
                    });
                    
                    setTimeout(() => {
                        if (processing) {
                            processing = false;
                            if (enabled && targetItems.length >= 2) {
                                setTimeout(() => {
                                    continueUpgrade();
                                }, 500);
                            }
                        }
                    }, 1000);
                    
                }, 500);
            }, 500);
            
        } catch (error) {
            mod.command.message('Upgrade error');
            processing = false;
        }
    }
    
    this.destructor = () => {
        cleanup();
    };
}