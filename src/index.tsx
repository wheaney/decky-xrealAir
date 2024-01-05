import {
    ButtonItem, ConfirmModal,
    definePlugin,
    Field, Focusable,
    NotchLabel,
    PanelSection,
    PanelSectionRow,
    ServerAPI,
    ServerResponse, showModal,
    SliderField,
    Spinner,
    staticClasses,
    ToggleField
} from "decky-frontend-lib";
// @ts-ignore
import React, {Dispatch, Fragment, SetStateAction, useEffect, useState, VFC} from "react";
import {FaGlasses} from "react-icons/fa";
import {BiMessageError} from "react-icons/bi";
import { PiPlugsConnected } from "react-icons/pi";
import { TbPlugConnectedX } from "react-icons/tb";
import {SiDiscord, SiKofi} from 'react-icons/si';
import {LuHelpCircle} from 'react-icons/lu';
import QrButton from "./QrButton";
import beam from "../assets/beam.png";
import {onChangeTutorial} from "./tutorials";
import {useStableState} from "./stableState";

interface Config {
    disabled: boolean;
    output_mode: OutputMode;
    mouse_sensitivity: number;
    display_zoom: number;
    display_distance: number;
    look_ahead: number;
    sbs_content: boolean;
    sbs_mode_stretched: boolean;
}

interface DriverState {
    heartbeat: number;
    connected_device_brand: string;
    connected_device_model: string;
    calibration_setup: CalibrationSetup;
    calibration_state: CalibrationState;
    sbs_mode_enabled: boolean;
    sbs_mode_supported: boolean;
}

interface ControlFlags {
    recenter_screen: boolean;
    recalibrate: boolean;
    sbs_mode: SbsModeControl;
}

type DirtyControlFlags = {
    last_updated?: number;
} & Partial<ControlFlags>

type InstallationStatus = "checking" | "inProgress" | "installed";
type OutputMode = "mouse" | "joystick" | "external_only"
type HeadsetModeOption = "virtual_display" | "vr_lite" | "disabled"
type CalibrationSetup = "AUTOMATIC" | "INTERACTIVE"
type CalibrationState = "NOT_CALIBRATED" | "CALIBRATING" | "CALIBRATED" | "WAITING_ON_USER"
type SbsModeControl = "unset" | "enable" | "disable"
const DirtyControlFlagsExpireMilliseconds = 3000

const HeadsetModeOptions: HeadsetModeOption[] =  ["virtual_display", "vr_lite", "disabled"];
const HeadsetModeDescriptions: {[key in HeadsetModeOption]: string} = {
    "virtual_display": "Virtual display is only available in-game.",
    "vr_lite": "Use Head movements to look around in-game.",
    "disabled": "Static display with no head-tracking."
};

function headsetModeToConfig(headsetMode: HeadsetModeOption, joystickMode: boolean): Partial<Config> {
    switch (headsetMode) {
        case "virtual_display":
            return { disabled: false, output_mode: "external_only" }
        case "vr_lite":
            return { disabled: false, output_mode: joystickMode ? "joystick" : "mouse" }
        case "disabled":
            return { disabled: true }
    }
}

function configToHeadsetMode(config?: Config): HeadsetModeOption {
    if (!config || config.disabled) return "disabled"
    if (config.output_mode == "external_only") return "virtual_display"
    return "vr_lite"
}

const HeadsetModeConfirmationTimeoutMs = 1000

const ModeNotchLabels: NotchLabel[] = [
    {
        label: "Virtual display",
        notchIndex: 0
    },
    {
        label: "VR\u2011Lite",
        notchIndex: 1
    },
    {
        label: "Disabled",
        notchIndex: 2
    },
];

const DisplayZoomNotchLabels: NotchLabel[] = [
    {
        label: "Smallest",
        notchIndex: 0
    },
    {
        label: "Default",
        notchIndex: 3
    },
    {
        label: "Biggest",
        notchIndex: 9
    }
];

const DisplayDisanceNotchLabels: NotchLabel[] = [
    {
        label: "Closest",
        notchIndex: 0
    },
    {
        label: "Default",
        notchIndex: 3
    },
    {
        label: "Farthest",
        notchIndex: 9
    }
];

const LookAheadNotchLabels: NotchLabel[] = [
    {
        label: "Default",
        notchIndex: 0
    },
    {
        label: "Lower",
        notchIndex: 1
    },
    {
        label: "Higher",
        notchIndex: 5
    }
];

const DeprecationWarningKey = "deprecation_warning";

const Content: VFC<{ serverAPI: ServerAPI }> = ({serverAPI}) => {

    const [config, setConfig] = useState<Config>();
    const [isJoystickMode, setJoystickMode] = useState<boolean>(false);
    const [driverState, setDriverState] = useState<DriverState>();
    const [dirtyControlFlags, setDirtyControlFlags] = useState<DirtyControlFlags>({});
    const [installationStatus, setInstallationStatus] = useState<InstallationStatus>("checking");
    const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
    const [error, setError] = useState<string>();
    const [dontShowAgainKeys, setDontShowAgainKeys] = useState<string[]>([]);
    const [dirtyHeadsetMode, stableHeadsetMode, setDirtyHeadsetMode] = useStableState<HeadsetModeOption | undefined>(undefined, HeadsetModeConfirmationTimeoutMs);

    async function retrieveConfig() {
        const configRes: ServerResponse<Config> = await serverAPI.callPluginMethod<{}, Config>("retrieve_config", {});
        if (configRes.success) {
            setConfig(configRes.result);
            if (configRes.result.output_mode == "joystick") setJoystickMode(true);
        } else {
            setError(configRes.result);
        }
    }

    // have this function call itself every second to keep the UI up to date
    async function retrieveDriverState() {
        const driverStateRes: ServerResponse<DriverState> = await serverAPI.callPluginMethod<{}, DriverState>("retrieve_driver_state", {});
        driverStateRes.success ? setDriverState(driverStateRes.result) : setError(driverStateRes.result);

        setTimeout(() => {
            retrieveDriverState().catch((err) => setError(err));
        }, 1000);
    }

    async function retrieveDontShowAgainKeys() {
        const dontShowAgainKeysRes: ServerResponse<string[]> = await serverAPI.callPluginMethod<{}, string[]>("retrieve_dont_show_again_keys", {});
        if (dontShowAgainKeysRes.success) {
            setDontShowAgainKeys(dontShowAgainKeysRes.result);
            if (!dontShowAgainKeysRes.result.includes(DeprecationWarningKey)) {
                showModal(<ConfirmModal
                    strTitle={"Move to \"XR Gaming\" plugin"}
                    strOKButtonText={"OK"}
                    bAlertDialog={true}
                    onOK={async () => await setDontShowAgain(DeprecationWarningKey)}>
                        <Focusable focusWithinClassName="gpfocuswithin" onActivate={() => {}} noFocusRing={true}><p>
                                SoooooOoOo, there's good news and bad news...
                        </p></Focusable>
                        <p>
                            <b>The good?</b><br/>
                            VITURE One support is ready! And Sideview mode is here.
                        </p>
                        <p>
                            <b>The bad?</b><br/>
                            Aerith dies at the end of Disc 1, so try not to get too attached.<br/>
                            Oh, and the <i>XREAL Air Driver</i> plugin name doesn't make sense anymore. So this
                            version of the plugin will soon be removed from the Decky store. To get the latest updates
                            -- including full VITURE support and Sideview mode -- you'll need to:
                            <ol style={{marginTop: 0, marginBottom: 10}}>
                                <li>Uninstall the <b color={"gray"}>XREAL Air Driver</b> plugin</li>
                                <li>Install the <b>XR Gaming</b> plugin</li>
                            </ol>
                        </p>
                        <p>
                            It should take only a minute to get back up and running. Enjoy!
                        </p>
                </ConfirmModal>);
            }
        } else {
            setError(dontShowAgainKeysRes.result);
        }
    }

    async function checkInstallation() {
        const installedRes: ServerResponse<boolean> = await serverAPI.callPluginMethod<{}, boolean>("is_driver_installed", {});
        if (installedRes.success) {
            if (installedRes.result) {
                setInstallationStatus("installed")
            } else {
                setInstallationStatus("inProgress")
                const installDriverRes = await serverAPI.callPluginMethod<{}, boolean>("install_driver", {});
                if (installDriverRes.success && installDriverRes.result)
                    setInstallationStatus("installed")
                else
                    setError("There was an error during setup. Try restarting your Steam Deck. " +
                        "If the error persists, please file an issue in the decky-xrealAir GitHub repository.")
            }
        } else {
            setError(installedRes.result);
        }
    }

    async function writeConfig(newConfig: Config) {
        const res = await serverAPI.callPluginMethod<{ config: Config }, void>("write_config", { config: newConfig });
        if (!res.success) {
            setError(res.result);
            await retrieveConfig();
        }
    }

    async function writeControlFlags(flags: Partial<ControlFlags>) {
        const res = await serverAPI.callPluginMethod<{ control_flags: Partial<ControlFlags>}, void>("write_control_flags", { control_flags: flags });
        res.success ? setDirtyControlFlags({...flags, last_updated: Date.now()}) : setError(res.result);
    }

    async function setDontShowAgain(key: string) {
        const res = await serverAPI.callPluginMethod<{ key: string }, void>("set_dont_show_again", { key });
        if (res.success) {
            setDontShowAgainKeys([...dontShowAgainKeys, key]);
        } else {
            setError(res.result);
        }
    }

    // these asynchronous calls should execute ONLY one time, hence the empty array as the second argument
    useEffect(() => {
        retrieveConfig().catch((err) => setError(err));
        checkInstallation().catch((err) => setError(err));
        retrieveDriverState().catch((err) => setError(err));
        retrieveDontShowAgainKeys().catch((err) => setError(err));
    }, []);

    useEffect(() => {
        // clear the dirty control flags if they're reflected in the state, or stale
        if (dirtyControlFlags.last_updated &&
            (Date.now() - dirtyControlFlags.last_updated) > DirtyControlFlagsExpireMilliseconds ||
            driverState && (
                dirtyControlFlags.sbs_mode == 'enable' && driverState.sbs_mode_enabled ||
                dirtyControlFlags.sbs_mode == 'disable' && !driverState.sbs_mode_enabled
            )
        ) {
            setDirtyControlFlags({})
        }
    }, [driverState])

    // this effect will be triggered after headsetMode has been stable for a certain period of time
    useEffect(() => {
        if (stableHeadsetMode && config) {
            onChangeTutorial(`headset_mode_${stableHeadsetMode}`, () => {
                updateConfig({
                    ...config,
                    ...headsetModeToConfig(stableHeadsetMode, config.output_mode == "joystick")
                }).catch(e => setError(e))
            }, dontShowAgainKeys, setDontShowAgain);
        }
    }, [stableHeadsetMode])

    const deviceConnected = !!driverState?.connected_device_brand && !!driverState?.connected_device_model
    const deviceName = deviceConnected ? `${driverState?.connected_device_brand} ${driverState?.connected_device_model}` : "No device connected"
    const headsetMode: HeadsetModeOption = dirtyHeadsetMode ?? configToHeadsetMode(config)
    const isDisabled = !deviceConnected || headsetMode == 'disabled'
    const isVirtualDisplayMode = !isDisabled && headsetMode == 'virtual_display'
    const isVrLiteMode = !isDisabled && headsetMode == 'vr_lite'
    let sbsModeEnabled = driverState?.sbs_mode_enabled ?? false
    if (dirtyControlFlags?.sbs_mode && dirtyControlFlags?.sbs_mode !== 'unset') sbsModeEnabled = dirtyControlFlags.sbs_mode === 'enable'
    const calibrating = dirtyControlFlags.recalibrate || driverState?.calibration_state == "CALIBRATING";

    const enableSbsButton = <PanelSectionRow>
        <ToggleField
            checked={sbsModeEnabled}
            label={"Enable side-by-side mode"}
            description={!driverState?.sbs_mode_enabled && "Adjust virtual display depth. View 3D content."}
            onChange={(sbs_mode_enabled) => {
                onChangeTutorial(`sbs_mode_enabled_${sbs_mode_enabled}`, () => {
                    writeControlFlags(
                        {
                            sbs_mode: sbs_mode_enabled ? 'enable' : 'disable'
                        }
                    )}, dontShowAgainKeys, setDontShowAgain
                )
            }}
        />
    </PanelSectionRow>;

    const joystickModeButton = <PanelSectionRow>
        <ToggleField
            checked={isJoystickMode}
            label={"Joystick mode"}
            description={"Try as a last resort if your game doesn't support mouse-look."}
            onChange={(joystickMode) => {
                if (config) {
                    updateConfig({
                        ...config,
                        ...headsetModeToConfig(headsetMode, joystickMode)
                    }).catch(e => setError(e))
                }
                setJoystickMode(joystickMode)
            }}/>
    </PanelSectionRow>;

    const advancedSettings = [
        isVrLiteMode && !isJoystickMode && joystickModeButton,
        isVirtualDisplayMode && driverState?.sbs_mode_supported && !driverState?.sbs_mode_enabled && enableSbsButton,
        config && isVirtualDisplayMode && <PanelSectionRow>
            <SliderField value={config.look_ahead}
                         min={0} max={30} notchTicksVisible={true}
                         notchCount={6} notchLabels={LookAheadNotchLabels}
                         step={3}
                         label={"Movement look-ahead"}
                         description={config.look_ahead > 0 ? "Use Default unless screen is noticeably ahead or behind your movements. May introduce jitter at higher values." : undefined}
                         onChange={(look_ahead) => {
                             if (config) {
                                 updateConfig({
                                     ...config,
                                     look_ahead
                                 }).catch(e => setError(e))
                             }
                         }}
            />
        </PanelSectionRow>,
        <PanelSectionRow>
            <ButtonItem disabled={calibrating}
                        description={!calibrating ? "Or triple-tap your headset." : undefined}
                        layout="below"
                        onClick={() => writeControlFlags({recalibrate: true})} >
                {calibrating ?
                    <span><Spinner style={{height: '16px', marginRight: 10}} />Calibrating headset</span> :
                    "Recalibrate headset"
                }
            </ButtonItem>
        </PanelSectionRow>
    ].filter(Boolean);

    // if advanced settings contains more than 1 element, filter out falsey values
    const advancedButtonVisible = advancedSettings.length > 1;

    async function updateConfig(newConfig: Config) {
        await Promise.all([setConfig(newConfig), writeConfig(newConfig)])
    }

    return (
        <Fragment>
            {error && <PanelSection>
                <PanelSectionRow style={{backgroundColor: "pink", borderColor: "red", color: "red"}}>
                    <BiMessageError/>{error}
                </PanelSectionRow>
            </PanelSection>}
            {!error && <Fragment>
                {installationStatus == "installed" && driverState && config &&
                    <PanelSection>
                        <PanelSectionRow style={{fontSize: 'medium', textAlign: 'center'}}>
                            <Field padding={'none'} childrenContainerWidth={'max'}>
                                <span style={{color: deviceConnected ? 'white' : 'gray'}}>
                                    {deviceName}
                                </span>
                                {deviceConnected && <span style={{marginLeft: 5, color: 'green'}}>
                                    connected
                                </span>}
                                <span style={{marginLeft: 7, color: deviceConnected ? 'green' : 'red', position: 'relative', top: '3px'}}>
                                    {deviceConnected ? <PiPlugsConnected /> : <TbPlugConnectedX />}
                                </span>
                            </Field>
                        </PanelSectionRow>
                        {deviceConnected && <PanelSectionRow>
                            <SliderField description={HeadsetModeDescriptions[headsetMode]}
                                         value={HeadsetModeOptions.indexOf(headsetMode)}
                                         notchTicksVisible={true}
                                         min={0} max={HeadsetModeOptions.length-1}
                                         notchLabels={ModeNotchLabels}
                                         notchCount={HeadsetModeOptions.length}
                                         onChange={(newMode) => setDirtyHeadsetMode(HeadsetModeOptions[newMode])}
                            />
                        </PanelSectionRow>}
                        {!isDisabled && isVrLiteMode && isJoystickMode && joystickModeButton}
                        {!isDisabled && isVrLiteMode && !isJoystickMode && <PanelSectionRow>
                            <SliderField value={config.mouse_sensitivity}
                                         min={5} max={100} showValue={true} notchTicksVisible={true}
                                         label={"Mouse sensitivity"}
                                         onChange={(mouse_sensitivity) => {
                                             if (config) {
                                                 updateConfig({
                                                     ...config,
                                                     mouse_sensitivity
                                                 }).catch(e => setError(e))
                                             }
                                         }}
                            />
                        </PanelSectionRow>}
                        {isVirtualDisplayMode && <Fragment>
                            <PanelSectionRow>
                                <SliderField value={config.display_zoom}
                                             min={0.25} max={2.5}
                                             notchCount={10}
                                             notchLabels={DisplayZoomNotchLabels}
                                             label={"Display size"}
                                             step={0.05}
                                             editableValue={true}
                                             onChange={(display_zoom) => {
                                                 if (config) {
                                                     updateConfig({
                                                         ...config,
                                                         display_zoom
                                                     }).catch(e => setError(e))
                                                 }
                                             }}
                                />
                            </PanelSectionRow>
                            <PanelSectionRow>
                                <ButtonItem disabled={calibrating || dirtyControlFlags.recenter_screen}
                                            description={!calibrating && !dirtyControlFlags.recenter_screen ? "Or double-tap your headset." : undefined}
                                            layout="below"
                                            onClick={() => writeControlFlags({recenter_screen: true})} >
                                    {calibrating ?
                                        <span><Spinner style={{height: '16px', marginRight: 10}} />Calibrating headset</span> :
                                        "Recenter display"
                                    }
                                </ButtonItem>
                            </PanelSectionRow>
                        </Fragment>}
                        {isVirtualDisplayMode && driverState?.sbs_mode_enabled && <Fragment>
                            {enableSbsButton}
                            <PanelSectionRow>
                                <SliderField value={config.display_distance}
                                             min={0.25} max={2.5}
                                             notchCount={10}
                                             notchLabels={DisplayDisanceNotchLabels}
                                             label={"Display distance"}
                                             description={"Adjust perceived display depth for eye comfort."}
                                             step={0.05}
                                             editableValue={true}
                                             onChange={(display_distance) => {
                                                 if (config) {
                                                     updateConfig({
                                                         ...config,
                                                         display_distance
                                                     }).catch(e => setError(e))
                                                 }
                                             }}
                                />
                            </PanelSectionRow>
                            <PanelSectionRow>
                                <ToggleField
                                    checked={config.sbs_mode_stretched}
                                    label={"Content is stretched"}
                                    description={"Enable if your content goes from the left edge to the right edge of the screen"}
                                    onChange={(sbs_mode_stretched) => {
                                        if (config) {
                                            updateConfig({
                                                ...config,
                                                sbs_mode_stretched
                                            }).catch(e => setError(e))
                                        }
                                    }}/>
                            </PanelSectionRow>
                            <PanelSectionRow>
                                <ToggleField
                                    checked={config.sbs_content}
                                    label={"Content is 3D"}
                                    description={"For when the source content is 3D SBS"}
                                    onChange={(sbs_content) => {
                                        if (config) {
                                            updateConfig({
                                                ...config,
                                                sbs_content,

                                                // assume 3d content is stretched to fill the screen
                                                sbs_mode_stretched: sbs_content ? true : config.sbs_mode_stretched
                                            }).catch(e => setError(e))
                                        }
                                    }}/>
                            </PanelSectionRow>
                        </Fragment>}
                        {!isDisabled && <Fragment>
                            {!showAdvanced && advancedButtonVisible && <PanelSectionRow>
                                <ButtonItem layout="below" onClick={() => setShowAdvanced(true)} >
                                    Show advanced settings
                                </ButtonItem>
                            </PanelSectionRow>}
                            {showAdvanced && advancedSettings}
                            {showAdvanced && advancedButtonVisible && <PanelSectionRow>
                                <ButtonItem layout="below" onClick={() => setShowAdvanced(false)} >
                                    Hide advanced settings
                                </ButtonItem>
                            </PanelSectionRow>}
                        </Fragment>}
                        {isVirtualDisplayMode &&
                            <QrButton icon={<LuHelpCircle />}
                                      url={"https://github.com/wheaney/decky-xrealAir#virtual-display-help"}
                                      followLink={true}
                            >
                                <span style={{fontSize: 'large'}}><span style={{
                                    fontWeight: 'bold',
                                    background: 'linear-gradient(to right, red, orange, yellow, green, blue, indigo, violet)',
                                    WebkitBackgroundClip: 'text',
                                    color: 'transparent'
                                }}>Virtual display</span> help</span>
                            </QrButton> ||
                            <QrButton icon={<LuHelpCircle />}
                                      url={"https://github.com/wheaney/decky-xrealAir#xreal-air-driver"}
                                      followLink={true}
                            >
                                Need help?
                            </QrButton>
                        }
                        {deviceConnected && <QrButton icon={<SiKofi />} url={"https://ko-fi.com/wheaney"}>
                            <span style={{fontSize: 'small'}}>
                                {driverState.connected_device_brand === 'XREAL' && <Fragment>
                                    Didn't need to buy a Beam?
                                    <img
                                        src={beam}
                                        style={{
                                            position: 'relative',
                                            top: '6px',
                                            left: '4px',
                                            width: '15px',
                                            height: 'auto',
                                            alignSelf: 'center',
                                        }}
                                    />
                                    <br/>
                                    <span style={{color:'white', fontWeight: 'bold'}}>
                                        Give $20 in support. Keep $99.
                                    </span>
                                </Fragment> || <Fragment>
                                    Want more great stuff like this?<br/>
                                    <span style={{color:'white', fontWeight: 'bold'}}>
                                        Become a <SiKofi style={{position: 'relative', top: '2px'}} color={"red"} /> supporter!
                                    </span>
                                </Fragment>}
                            </span>
                        </QrButton>}
                        <QrButton icon={<SiDiscord />} url={"https://discord.gg/GRQcfR5h9c"}>
                            <span style={{fontSize: 'small'}}>
                                News. Discussions. Help.<br/>
                                <span style={{color:'white', fontWeight: 'bold'}}>Join the chat!</span>
                            </span>
                        </QrButton>
                    </PanelSection> ||
                    <PanelSection>
                        <PanelSectionRow>
                            <Spinner style={{height: '48px'}} />
                            {installationStatus == "inProgress" &&
                                <span>Installing...</span>
                            }
                        </PanelSectionRow>
                    </PanelSection>
                }
            </Fragment>}
        </Fragment>
    );
};

export default definePlugin((serverApi: ServerAPI) => {
    return {
        title: <div className={staticClasses.Title}>XREAL Air Driver</div>,
        content: <Content serverAPI={serverApi}/>,
        icon: <FaGlasses/>
    };
});
