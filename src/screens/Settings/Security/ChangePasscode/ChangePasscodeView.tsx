/**
 * Change Passcode Screen
 */

import React, { Component } from 'react';
import { Results } from 'realm';
import { View, Text, Alert, InteractionManager } from 'react-native';

import { CoreRepository, AccountRepository } from '@store/repositories';
import { AccountSchema } from '@store/schemas/latest';
import { EncryptionLevels } from '@store/types';

import Vault from '@common/libs/vault';
import { Navigator } from '@common/helpers/navigator';
import { Prompt } from '@common/helpers/interface';

import { AuthenticationService } from '@services';

import { AppScreens } from '@common/constants';

import { Header, PinInput } from '@components/General';

import Localize from '@locale';

// style
import { AppStyles } from '@theme';
import styles from './styles';

/* types ==================================================================== */
enum Steps {
    ENTER_OLD_PASSCODE = 'ENTER_OLD_PASSCODE',
    ENTER_NEW_PASSCODE = 'ENTER_NEW_PASSCODE',
    CONFIRM_NEW_PASSCODE = 'CONFIRM_NEW_PASSCODE',
}

interface Props {}

interface State {
    newPasscode: string;
    currentStep: Steps;
    stepDescription: string;
}
/* Component ==================================================================== */
class ChangePasscodeView extends Component<Props, State> {
    static screenName = AppScreens.Settings.ChangePasscode;
    private readonly pinInput: React.RefObject<PinInput>;

    static options() {
        return {
            bottomTabs: { visible: false },
        };
    }

    constructor(props: Props) {
        super(props);

        this.state = {
            newPasscode: '',
            currentStep: Steps.ENTER_OLD_PASSCODE,
            stepDescription: Localize.t('settings.enterOldPasscode'),
        };

        this.pinInput = React.createRef();
    }

    componentDidMount() {
        InteractionManager.runAfterInteractions(this.focusPinInput);
    }

    cleanPinInput = () => {
        setTimeout(() => {
            if (this.pinInput.current) {
                this.pinInput.current.clean();
            }
        }, 100);
    };

    focusPinInput = () => {
        setTimeout(() => {
            if (this.pinInput.current) {
                this.pinInput.current.focus();
            }
        }, 100);
    };

    changeStep = (step: Steps) => {
        let stepDescription;
        switch (step) {
            case Steps.ENTER_OLD_PASSCODE:
                stepDescription = Localize.t('settings.enterOldPasscode');
                break;
            case Steps.ENTER_NEW_PASSCODE:
                stepDescription = Localize.t('settings.enterNewPasscode');
                break;
            case Steps.CONFIRM_NEW_PASSCODE:
                stepDescription = Localize.t('settings.enterNewPasscodeAgain');
                break;
            default:
                break;
        }

        this.setState(
            {
                currentStep: step,
                stepDescription,
            },
            () => {
                this.cleanPinInput();
                this.focusPinInput();
            },
        );
    };

    onChangePasscodeSuccess = async () => {
        // everything went well
        await Navigator.pop();

        // show success alert
        Alert.alert(Localize.t('global.success'), Localize.t('settings.passcodeChangedSuccess'));
    };

    onChangePasscodeError = () => {
        Alert.alert(Localize.t('global.error'), Localize.t('global.unexpectedErrorOccurred'));
    };

    processChangePasscode = () => {
        const { newPasscode } = this.state;

        // eslint-disable-next-line no-async-promise-executor
        return new Promise(async (resolve, reject) => {
            try {
                // get current passcode
                const { passcode } = CoreRepository.getSettings();

                // store the new passcode in the store
                const newEncPasscode = await CoreRepository.setPasscode(newPasscode);

                if (!newEncPasscode) {
                    Alert.alert(Localize.t('global.error'), Localize.t('setupPasscode.UnableToStoreThePasscode'));
                    return;
                }

                // get all accounts with encryption level Passcode
                const accounts = AccountRepository.findBy(
                    'encryptionLevel',
                    EncryptionLevels.Passcode,
                ) as Results<AccountSchema>;

                const passcodeVaultNames = accounts.map((account) => account.publicKey);

                let isReKeyFailed = false;

                try {
                    await Vault.reKeyBatch(passcodeVaultNames, passcode, newEncPasscode);
                } catch (e) {
                    isReKeyFailed = true;
                }

                // in case of vaults reKey failed, rollback the passcode to old one
                if (isReKeyFailed) {
                    await CoreRepository.setPasscode(passcode);
                }

                resolve(true);
            } catch (e) {
                reject(e);
            }
        });
    };

    changePasscode = async () => {
        Navigator.showOverlay(AppScreens.Overlay.CriticalProcessing, {
            task: this.processChangePasscode,
            onSuccess: this.onChangePasscodeSuccess,
            onError: this.onChangePasscodeError,
        });
    };

    checkOldPasscode = (oldPasscode: string) => {
        AuthenticationService.authenticatePasscode(oldPasscode)
            .then(() => {
                this.changeStep(Steps.ENTER_NEW_PASSCODE);
            })
            .catch((e) => {
                this.cleanPinInput();
                Alert.alert(Localize.t('global.error'), e.toString(), [{ text: 'OK', onPress: this.focusPinInput }], {
                    cancelable: false,
                });
            });
    };

    checkNewPasscode = (newPasscode: string, isStrong: boolean) => {
        if (isStrong) {
            this.setState({
                newPasscode,
            });
            this.changeStep(Steps.CONFIRM_NEW_PASSCODE);
        } else {
            Prompt(
                Localize.t('setupPasscode.weakPasscode'),
                Localize.t('setupPasscode.weakPasscodeDescription'),
                [
                    {
                        text: Localize.t('setupPasscode.useAnyway'),
                        onPress: () => {
                            this.setState({
                                newPasscode,
                            });
                            this.changeStep(Steps.CONFIRM_NEW_PASSCODE);
                        },
                        style: 'destructive',
                    },
                    {
                        text: Localize.t('setupPasscode.changePasscode'),
                        onPress: () => {
                            this.cleanPinInput();
                            this.focusPinInput();
                        },
                    },
                ],
                { type: 'default' },
            );
        }
    };

    checkConfirmPasscode = (newPasscodeConfirm: string) => {
        const { newPasscode } = this.state;

        if (newPasscode !== newPasscodeConfirm) {
            this.changeStep(Steps.ENTER_NEW_PASSCODE);
            Alert.alert(
                Localize.t('global.error'),
                Localize.t('settings.newOldPasscodeNotMatch'),
                [{ text: 'OK', onPress: this.focusPinInput }],
                { cancelable: false },
            );
            return;
        }

        // change passcode if everything looks good
        this.changePasscode();
    };

    onPasscodeEntered = (passcode: string, isStrong?: boolean) => {
        const { currentStep } = this.state;

        switch (currentStep) {
            case Steps.ENTER_OLD_PASSCODE:
                this.checkOldPasscode(passcode);
                break;
            case Steps.ENTER_NEW_PASSCODE:
                this.checkNewPasscode(passcode, isStrong);
                break;
            case Steps.CONFIRM_NEW_PASSCODE:
                this.checkConfirmPasscode(passcode);
                break;
            default:
                break;
        }
    };

    render() {
        const { currentStep, stepDescription } = this.state;

        return (
            <View testID="change-passcode-screen" style={styles.container}>
                <Header
                    leftComponent={{
                        icon: 'IconChevronLeft',
                        onPress: Navigator.pop,
                    }}
                    centerComponent={{ text: Localize.t('settings.changePasscode') }}
                />
                <View style={[AppStyles.flex3, AppStyles.flexEnd]}>
                    <Text style={[AppStyles.h5, AppStyles.textCenterAligned]}>{stepDescription}</Text>
                </View>
                <View style={[AppStyles.flex8, AppStyles.paddingSml, AppStyles.centerAligned]}>
                    <PinInput
                        ref={this.pinInput}
                        autoFocus={false}
                        codeLength={6}
                        checkStrength={currentStep === Steps.ENTER_NEW_PASSCODE}
                        onFinish={this.onPasscodeEntered}
                    />
                </View>
            </View>
        );
    }
}

/* Export Component ==================================================================== */
export default ChangePasscodeView;
