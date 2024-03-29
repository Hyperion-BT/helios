//@ts-check
// CoinSelection

import { 
    assert
} from "./utils.js";

import {
    Value
} from "./helios-data.js";

import {
    TxInput
} from "./tx-builder.js";

/**
 * Returns two lists. The first list contains the selected UTxOs, the second list contains the remaining UTxOs.
 * @typedef {(utxos: TxInput[], amount: Value) => [TxInput[], TxInput[]]} CoinSelectionAlgorithm
 */

/**
 * Collection of common [coin selection algorithms](https://cips.cardano.org/cips/cip2/).
 * @namespace
 */
export const CoinSelection = {
    /**
     * @internal
     * @param {TxInput[]} utxos 
     * @param {Value} amount 
     * @param {boolean} largestFirst
     * @returns {[TxInput[], TxInput[]]} - [picked, not picked that can be used as spares]
     */
    selectExtremumFirst: (utxos, amount, largestFirst) => {
        let sum = new Value();

        /** @type {TxInput[]} */
        let notSelected = utxos.slice();

        /** @type {TxInput[]} */
        const selected = [];

        /**
         * Selects smallest utxos until 'needed' is reached
         * @param {bigint} neededQuantity
         * @param {(utxo: TxInput) => bigint} getQuantity
         */
        function select(neededQuantity, getQuantity) {
            // first sort notYetPicked in ascending order when picking smallest first,
            // and in descending order when picking largest first
            // sort UTxOs that contain more assets last
            notSelected.sort((a, b) => {
                const qa = getQuantity(a);
                const qb = getQuantity(b);

                const sign = largestFirst ? -1 : 1;

                if (qa != 0n && qb == 0n) {
                    return sign;
                } else if (qa == 0n && qb != 0n) {
                    return -sign;
                } else if (qa == 0n && qb == 0n) {
                    return 0;
                } else {
                    const na = a.value.assets.nTokenTypes;
                    const nb = b.value.assets.nTokenTypes;

                    if (na == nb) {
                        return Number(qa - qb)*sign;
                    } else if (na < nb) {
                        return sign;
                    } else {
                        return -sign
                    }
                }
            });

            let count = 0n;
            const remaining = [];

            while (count < neededQuantity || count == 0n) { // must select at least one utxo if neededQuantity == 0n
                const utxo = notSelected.shift();

                if (utxo === undefined) {
                    console.error(selected.map(s => JSON.stringify(s.dump(), undefined, "  ")));
                    console.error(JSON.stringify(amount.dump(), undefined, "  "));
                    throw new Error("not enough utxos to cover amount");
                } else {
                    const qty = getQuantity(utxo);

                    if (qty > 0n) {
                        count += qty;
                        selected.push(utxo);
                        sum = sum.add(utxo.value);
                    } else {
                        remaining.push(utxo);
                    }
                }
            }

            notSelected = notSelected.concat(remaining);
        }

        /**
         * Select UTxOs while looping through (MintingPolicyHash,TokenName) entries
         */
        const mphs = amount.assets.mintingPolicies;

        for (const mph of mphs) {
            const tokenNames = amount.assets.getTokenNames(mph);

            for (const tokenName of tokenNames) {
                const need = amount.assets.get(mph, tokenName);
                const have = sum.assets.get(mph, tokenName);

                if (have < need) {
                    const diff = need - have;

                    select(diff, (utxo) => utxo.value.assets.get(mph, tokenName));
                }
            }
        }

        // now use the same strategy for lovelace
        const need = amount.lovelace;
        const have = sum.lovelace;

        if (have < need) {
            const diff = need - have;

            select(diff, (utxo) => utxo.value.lovelace);
        }

        assert(selected.length + notSelected.length == utxos.length, "internal error: select algorithm doesn't conserve utxos");

        return [selected, notSelected];
    },

    /**
     * Selects UTxOs from a list by iterating through the tokens in the given `Value` and picking the UTxOs containing the smallest corresponding amount first.
     * This method can be used to eliminate dust UTxOs from a wallet.
     * @type {CoinSelectionAlgorithm}
     */
    selectSmallestFirst: (utxos, amount) => {
        return CoinSelection.selectExtremumFirst(utxos, amount, false);
    },

    /**
     * * Selects UTxOs from a list by iterating through the tokens in the given `Value` and picking the UTxOs containing the largest corresponding amount first.
     * @type {CoinSelectionAlgorithm}
     */
    selectLargestFirst: (utxos, amount) => {
        return CoinSelection.selectExtremumFirst(utxos, amount, true);
    }
}