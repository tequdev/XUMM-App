/**
 * Accounts Edit Screen
 */

import { first, filter } from 'lodash';
import React, { Component, Fragment } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';

import { Prompt } from '@common/helpers/interface';
import { Navigator } from '@common/helpers/navigator';
import { getAccountName } from '@common/helpers/resolver';

import { GetCardEnforcedSecurity, GetCardId, TangemSecurity } from '@common/utils/tangem';
import { AppConfig, AppScreens } from '@common/constants';

import { AccountRepository, CoreRepository } from '@store/repositories';
import { AccountModel } from '@store/models';
import { AccessLevels, AccountTypes, EncryptionLevels } from '@store/types';

import { Button, Header, Icon, Spacer, Switch, TouchableDebounce } from '@components/General';

import Localize from '@locale';

// style
import { AppStyles } from '@theme';
import styles from './styles';

/* types ==================================================================== */
export interface Props {
    account: AccountModel;
}

export interface State {
    account: AccountModel;
}

/* Component ==================================================================== */
class AccountSettingsView extends Component<Props, State> {
    static screenName = AppScreens.Account.Edit.Settings;

    static options() {
        return {
            bottomTabs: { visible: false },
        };
    }

    constructor(props: Props) {
        super(props);

        this.state = {
            account: props.account,
        };
    }

    componentDidMount() {
        AccountRepository.on('accountUpdate', this.onAccountUpdate);
    }

    componentWillUnmount() {
        AccountRepository.off('accountUpdate', this.onAccountUpdate);
    }

    onAccountUpdate = (updateAccount: AccountModel) => {
        const { account } = this.state;

        if (account?.isValid() && updateAccount.address === account.address) {
            this.setState({ account: updateAccount });
        }
    };

    accountLabelPressed = () => {
        const { account } = this.state;

        Prompt(
            Localize.t('account.accountLabel'),
            Localize.t('account.pleaseEnterLabel'),
            [
                { text: Localize.t('global.cancel') },
                {
                    text: Localize.t('global.save'),
                    onPress: this.changeAccountLabel,
                },
            ],
            { type: 'plain-text', defaultValue: account.label },
        );
    };

    changeAccountLabel = (label: string) => {
        const { account } = this.state;

        if (!label || label === account.label) return;

        if (label.length > AppConfig.accountLabelLimit) {
            Alert.alert(Localize.t('global.error'), Localize.t('account.accountLabelCannotBeMoreThan'));
            return;
        }

        const labelClean = label.replace(/\n/g, '');

        AccountRepository.update({
            address: account.address,
            label: labelClean,
        });

        // update catch for this account
        getAccountName.cache.set(
            account.address,
            new Promise((resolve) => {
                resolve({ name: labelClean, source: 'accounts' });
            }),
        );
    };

    showAccessLevelPicker = () => {
        const { account } = this.state;

        Navigator.push(AppScreens.Global.Picker, {
            title: Localize.t('account.accessLevel'),
            description: Localize.t('account.accessLevelChangeAlert'),
            items: [
                { title: Localize.t('account.readOnly'), value: AccessLevels.Readonly },
                { title: Localize.t('account.fullAccess'), value: AccessLevels.Full },
            ],
            selected: account.accessLevel,
            onSelect: this.onAccessLevelSelected,
        });
    };

    onAccountDowngradeRequest = () => {
        const { account } = this.state;

        // auth with passcode for accounts with Passcode as encryption level
        if (account.encryptionLevel === EncryptionLevels.Passcode) {
            Navigator.showOverlay(AppScreens.Overlay.Auth, {
                canAuthorizeBiometrics: false,
                onSuccess: this.downgradeAccountAccessLevel,
            });
            // for accounts with passphrase auth with passphrase
        } else if (account.encryptionLevel === EncryptionLevels.Passphrase) {
            Navigator.showOverlay(AppScreens.Overlay.PassphraseAuthentication, {
                account,
                onSuccess: this.downgradeAccountAccessLevel,
            });
        }
    };

    downgradeAccountAccessLevel = () => {
        const { account } = this.state;

        // downgrade the access level
        AccountRepository.downgrade(account).catch(() => {
            Alert.alert('Error', 'Unexpected error happened');
        });
    };

    onAccessLevelSelected = (item: any) => {
        const { account } = this.state;

        const accessLevel = item.value;

        // nothing changed
        if (accessLevel === account.accessLevel) return;

        // downgrading
        if (accessLevel === AccessLevels.Readonly && account.accessLevel === AccessLevels.Full) {
            Prompt(
                Localize.t('global.pleaseNote'),
                account.type === AccountTypes.Regular
                    ? Localize.t('account.downgradingAccessLevelWarning')
                    : Localize.t('account.downgradingAccessLevelWarningPhysical'),
                [
                    { text: Localize.t('global.cancel') },
                    {
                        text: Localize.t('global.doIt'),
                        onPress: this.onAccountDowngradeRequest,
                        style: 'destructive',
                    },
                ],
                { type: 'default' },
            );
            return;
        }

        // upgrading
        Prompt(
            Localize.t('global.notice'),
            Localize.t('account.upgradingAccessLevelWarning'),
            [
                { text: Localize.t('global.cancel') },
                {
                    text: Localize.t('global.doIt'),
                    testID: 'yes-iam-sure-button',
                    onPress: () => {
                        Navigator.push(AppScreens.Account.Import, { upgradeAccount: account });
                    },
                },
            ],
            { type: 'default' },
        );
    };

    showChangePassphrase = () => {
        const { account } = this.props;
        Navigator.push(AppScreens.Account.Edit.ChangePassphrase, { account });
    };

    showChangeTangemSecurity = () => {
        const { account } = this.props;
        Navigator.push(AppScreens.Account.Edit.ChangeTangemSecurityEnforce, { account });
    };

    removeAccount = () => {
        const { account } = this.state;

        // get current core settings
        const coreSettings = CoreRepository.getSettings();

        // check if we are removing default account, then we need to select another account as default
        if (account.address === coreSettings.account?.address) {
            const accounts = AccountRepository.getAccounts();
            CoreRepository.saveSettings({
                account: first(filter(accounts, (a: any) => a.address !== account.address)),
            });
        }

        // remove account
        AccountRepository.purge(account);

        // pop the screen
        Navigator.pop();
    };

    onAccountRemoveRequest = () => {
        const { account } = this.state;

        // for readonly accounts just remove without any auth
        if (account.accessLevel === AccessLevels.Readonly) {
            this.removeAccount();
            return;
        }

        // auth with passcode for full access accounts
        Navigator.showOverlay(AppScreens.Overlay.Auth, {
            canAuthorizeBiometrics: false,
            onSuccess: this.removeAccount,
        });
    };

    onRemovePress = () => {
        Prompt(
            Localize.t('global.warning'),
            Localize.t('account.accountRemoveWarning'),
            [
                { text: Localize.t('global.cancel') },
                {
                    text: Localize.t('global.doIt'),
                    onPress: this.onAccountRemoveRequest,
                    style: 'destructive',
                },
            ],
            { type: 'default' },
        );
    };

    onHiddenChange = (value: boolean) => {
        const { account } = this.props;

        const coreSettings = CoreRepository.getSettings();

        if (value) {
            const allAccounts = AccountRepository.getAccounts();
            const hiddenAccounts = AccountRepository.getAccounts({ hidden: true });

            // check if we are hiding all accounts
            if (allAccounts.length - hiddenAccounts.length === 1) {
                Alert.alert(Localize.t('global.error'), Localize.t('account.unableToHideAllAccountsError'));
                return;
            }

            // check if we are hiding the default account
            if (coreSettings.account?.address === account.address) {
                Alert.alert(Localize.t('global.error'), Localize.t('account.unableToHideDefaultAccountError'));
                return;
            }
        }

        // update account hidden value
        AccountRepository.update({
            address: account.address,
            hidden: value,
        });
    };

    render() {
        const { account } = this.state;

        return (
            <View testID="account-settings-screen" style={styles.container}>
                <Header
                    leftComponent={{
                        testID: 'back-button',
                        icon: 'IconChevronLeft',
                        onPress: Navigator.pop,
                    }}
                    centerComponent={{
                        text: Localize.t('account.accountSettings'),
                    }}
                />

                <View style={AppStyles.contentContainer}>
                    <ScrollView>
                        {/* Account Label */}
                        <Text style={styles.descriptionText}>{Localize.t('account.accountSettingsDescription')}</Text>

                        <View style={styles.row}>
                            <Text numberOfLines={1} style={styles.label} testID="address-label">
                                {Localize.t('global.address')}
                            </Text>

                            <Text numberOfLines={1} selectable style={styles.address}>
                                {account.address}
                            </Text>
                        </View>

                        {account.type === AccountTypes.Tangem && (
                            <View style={styles.row}>
                                <Text numberOfLines={1} style={styles.label} testID="tangem-card-id">
                                    {Localize.t('account.cardId')}
                                </Text>

                                <Text selectable style={styles.address}>
                                    {GetCardId(account.additionalInfo)}
                                </Text>
                            </View>
                        )}

                        {/* Account Label */}
                        <TouchableDebounce
                            testID="account-label-button"
                            style={styles.row}
                            onPress={this.accountLabelPressed}
                        >
                            <Text numberOfLines={1} style={styles.label}>
                                {Localize.t('account.accountLabel')}
                            </Text>
                            <Text numberOfLines={1} style={styles.value}>
                                {account.label}
                            </Text>
                            <Icon size={25} style={styles.rowIcon} name="IconChevronRight" />
                        </TouchableDebounce>

                        {/* Account Access Level */}
                        {account.type === AccountTypes.Regular && (
                            <TouchableDebounce
                                testID="account-access-level-button"
                                style={styles.row}
                                onPress={this.showAccessLevelPicker}
                            >
                                <Text numberOfLines={1} style={styles.label}>
                                    {Localize.t('account.accessLevel')}
                                </Text>
                                <Text testID="account-access-level-value" style={styles.value}>
                                    {account.accessLevel === AccessLevels.Full
                                        ? Localize.t('account.fullAccess')
                                        : Localize.t('account.readOnly')}
                                </Text>
                                <Icon size={25} style={styles.rowIcon} name="IconChevronRight" />
                            </TouchableDebounce>
                        )}
                        {/* <Text style={styles.descriptionText}>{Localize.t('account.passwordOptionDesc')}</Text> */}
                        {account.accessLevel === AccessLevels.Full && (
                            <Fragment key="security">
                                {/* Encryption Label */}
                                <View style={styles.row}>
                                    <Text numberOfLines={1} style={styles.label}>
                                        {Localize.t('account.securityLevel')}
                                    </Text>
                                    <Text style={styles.value}>
                                        {account.encryptionLevel === EncryptionLevels.Passphrase
                                            ? 'Password'
                                            : account.encryptionLevel}
                                    </Text>
                                </View>

                                {/* Change passphrase */}
                                {account.encryptionLevel === EncryptionLevels.Passphrase && (
                                    <TouchableDebounce
                                        testID="change-password-button"
                                        style={styles.row}
                                        onPress={this.showChangePassphrase}
                                    >
                                        <Text style={styles.label}>{Localize.t('account.changePassword')}</Text>
                                    </TouchableDebounce>
                                )}
                            </Fragment>
                        )}

                        {account.type === AccountTypes.Tangem && (
                            <TouchableDebounce style={styles.row} onPress={this.showChangeTangemSecurity}>
                                <Text numberOfLines={1} style={styles.label}>
                                    {Localize.t('account.cardEnforcedSecurity')}
                                </Text>
                                <Text style={styles.value}>
                                    {(() => {
                                        switch (GetCardEnforcedSecurity(account.additionalInfo)) {
                                            case TangemSecurity.Passcode:
                                                return Localize.t('global.passcode');
                                            case TangemSecurity.AccessCode:
                                                return Localize.t('global.accessCode');
                                            case TangemSecurity.LongTap:
                                                return Localize.t('global.longTap');
                                            default:
                                                return null;
                                        }
                                    })()}
                                </Text>
                                <Icon size={25} style={styles.rowIcon} name="IconChevronRight" />
                            </TouchableDebounce>
                        )}

                        <View style={styles.row}>
                            <Text numberOfLines={1} style={styles.label}>
                                {Localize.t('global.hidden')}
                            </Text>
                            <View style={[AppStyles.flex1, AppStyles.rightAligned]}>
                                <Switch checked={account.hidden} onChange={this.onHiddenChange} />
                            </View>
                        </View>

                        <Spacer size={50} />

                        <Button
                            numberOfLines={1}
                            label={Localize.t('account.removeFromXaman')}
                            icon="IconTrash"
                            iconStyle={AppStyles.imgColorWhite}
                            style={[AppStyles.marginSml, AppStyles.buttonRed]}
                            onPress={this.onRemovePress}
                        />
                    </ScrollView>
                </View>
            </View>
        );
    }
}

/* Export Component ==================================================================== */
export default AccountSettingsView;
