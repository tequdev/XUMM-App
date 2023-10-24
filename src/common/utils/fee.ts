import BigNumber from 'bignumber.js';

import { sign, derive, XrplDefinitions } from 'xrpl-accountlib';

/**
 * Prepare transaction for getting hook tx fee
 * @param txJson
 * @param definitions
 * @returns string
 */
const PrepareTxForHookFee = (txJson: any, definitions: any): string => {
    if (!txJson || typeof txJson !== 'object') {
        throw new Error('PrepareTxForHookFee requires a json transaction to calculate the fee for');
    }

    // normalize the transaction
    // Fee and SigningPubKey should be empty
    const transaction = {
        ...txJson,
        Fee: '0',
        SigningPubKey: '',
    };

    // check if we need to populate the transaction with dummy details
    // set the Sequence if not set
    if (!Object.prototype.hasOwnProperty.call(txJson, 'Sequence')) {
        Object.assign(transaction, {
            Sequence: 0,
        });
    }

    // Payment payloads can have no amount set
    if (txJson.TransactionType === 'Payment' && !txJson.Amount) {
        Object.assign(transaction, {
            Amount: '0',
        });
    }

    // set the definitions if exist
    let xrplDefinitions;
    if (typeof definitions === 'object') {
        xrplDefinitions = new XrplDefinitions(definitions);
    }

    // sign the transaction with a dummy account
    return sign(transaction, derive.passphrase(''), xrplDefinitions).signedTransaction;
};

/**
 * Calculate the available fees base on current network fee data set
 * @param feeDataSet
 * @returns object
 */
const NormalizeFeeDataSet = (feeDataSet: {
    drops: { base_fee: number };
    fee_hooks_feeunits: number;
}): {
    availableFees: {
        type: 'LOW' | 'MEDIUM' | 'HIGH';
        value: string;
    }[];
    feeHooks: number;
    suggested: 'LOW';
} => {
    if (!feeDataSet || typeof feeDataSet !== 'object') {
        throw new Error('NormalizeFeeDataSet required a valid fee data set!');
    }
    const { drops: { base_fee } = { base_fee: 12 }, fee_hooks_feeunits: fee_hooks } = feeDataSet;

    const baseFee = BigNumber.maximum(12, base_fee);

    const feeCalc = (level: number) => {
        let nearest = new BigNumber(1);
        let multiplier = new BigNumber(100);

        if (level > 0) {
            nearest = new BigNumber(0.5).multipliedBy(10 ** (baseFee.toString(10).length - 1));
            multiplier = new BigNumber(100).plus(
                level ** new BigNumber(2.1).minus(baseFee.multipliedBy(0.000005)).toNumber(),
            );
        }

        return baseFee
            .dividedBy(100)
            .multipliedBy(multiplier)
            .dividedBy(nearest)
            .integerValue(BigNumber.ROUND_CEIL)
            .multipliedBy(nearest)
            .toFixed(0, BigNumber.ROUND_UP);
    };

    return {
        availableFees: [
            {
                type: 'LOW',
                value: feeCalc(0),
            },
            {
                type: 'MEDIUM',
                value: feeCalc(4),
            },
            {
                type: 'HIGH',
                value: feeCalc(8),
            },
        ],
        feeHooks: fee_hooks || 0,
        suggested: 'LOW',
    };
};

export { NormalizeFeeDataSet, PrepareTxForHookFee };
