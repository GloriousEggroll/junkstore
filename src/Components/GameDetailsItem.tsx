import { Focusable, ServerAPI, ModalRoot, sleep, gamepadDialogClasses, showModal, Navigation } from "decky-frontend-lib";
import { useState, useEffect, VFC, useRef } from "react";
import GameDisplay from "./GameDisplay";
import { ContentResult, ContentType, EmptyContent, ExecuteGetGameDetailsArgs, ExecuteInstallArgs, GameDetails, GameImages, LaunchOptions, MenuAction, ProgressUpdate, ScriptActions } from "../Types/Types";
import { runApp } from "../Utils/utils";
import Logger from "../Utils/logger";
import { Loading } from "./Loading";
import { executeAction } from "../Utils/executeAction";
import { footerClasses } from '../staticClasses';
import { reaction } from 'mobx';

const gameDetailsRootClass = 'game-details-modal-root';

interface GameDetailsItemProperties {
    serverAPI: ServerAPI;
    shortname: string;
    initActionSet: string;
    closeModal?: any;
}

export const GameDetailsItem: VFC<GameDetailsItemProperties> = ({ serverAPI, shortname, initActionSet, closeModal }) => {

    const logger = new Logger("GameDetailsItem");
    logger.log("GameDetailsItem startup");
    const [scriptActions, setScriptActions] = useState<MenuAction[]>([]);
    const [gameData, setGameData] = useState<ContentResult<GameDetails | EmptyContent>>({ Type: "Empty", Content: { Details: {} } });
    logger.log("GameDetailsItem gameData", gameData);
    const [steamClientID, setSteamClientID] = useState("");
    logger.log("GameDetailsItem steamClientID", steamClientID);
    const [installing, setInstalling] = useState(false);
    logger.log("GameDetailsItem installing", installing);

    const originRoute = location.pathname.replace('/routes', '');
    useEffect(() => reaction(() => SteamUIStore.WindowStore.GamepadUIMainWindowInstance?.LocationPathName, closeModal), []);

    const [progress, setProgress] = useState<ProgressUpdate>({
        Percentage: 0,
        Description: ""
    });
    logger.log("GameDetailsItem progress", progress);

    const installingRef = useRef(installing);
    logger.log("GameDetailsItem installingRef", installingRef);
    useEffect(() => {
        logger.log("GameDetailsItem installingRef.current = installing");
        installingRef.current = installing;
    }, [installing]);


    useEffect(() => {
        if (installing) {
            logger.log("GameDetailsItem updateProgress");
            updateProgress();
        }
    }, [installing]);
    //const [] = useState("Play Game");
    useEffect(() => {
        logger.log("GameDetailsItem onInit");
        onInit();
    }, []);

    const reloadData = async () => {
        setGameData({ Type: "Empty", Content: { Details: {} } });
        onInit();
    };
    const onInit = async () => {
        try {
            logger.debug("onInit starting");
            const gameDetailsResponse = await executeAction<ExecuteGetGameDetailsArgs, GameDetails>(
                serverAPI,
                initActionSet,
                "GetDetails",
                {
                    shortname: shortname
                }
            );

            logger.debug("onInit res", gameDetailsResponse);
            if (gameDetailsResponse === null) {
                return;
            }
            setSteamClientID(gameDetailsResponse.Content.SteamClientID);
            logger.debug("onInit finished");
            const scriptActionResponse = await executeAction<ExecuteGetGameDetailsArgs, ScriptActions>(
                serverAPI,
                initActionSet,
                "GetGameScriptActions",
                {
                    shortname: shortname
                }
            );
            logger.debug("onInit actionRes", scriptActionResponse);
            if (scriptActionResponse === null) {
                return;
            }
            logger.debug("onInit scriptActions", scriptActionResponse.Content);
            setGameData(gameDetailsResponse);
            setScriptActions(scriptActionResponse.Content.Actions);
        } catch (error) {
            logger.error(error);
        }
    };

    const updateProgress = async () => {
        while (installingRef.current) {
            logger.debug("updateProgress loop starting");
            try {
                logger.debug("updateProgress");

                executeAction<ExecuteGetGameDetailsArgs, ProgressUpdate>(
                    serverAPI,
                    initActionSet,
                    "GetProgress",
                    {
                        shortname: shortname
                    }
                ).then((progressUpdateResponse) => {
                    if (progressUpdateResponse === null) {
                        return;
                    }
                    const progressUpdate = progressUpdateResponse.Content;
                    if (progressUpdate != null) {
                        logger.debug(progressUpdate);
                        setProgress(progressUpdate);
                        logger.debug(progressUpdate.Percentage);
                        if (progressUpdate.Percentage >= 100) {
                            setInstalling(false);
                            logger.debug("setInstalling(false)");
                            install();
                            return;
                        }
                    }
                }).catch((e) => {
                    logger.error('Error in progress updater', e);
                });
            } catch (e) {
                logger.error('Error in progress updater', e);
            }

            logger.debug("sleeping");
            await sleep(1000);
            logger.debug("woke up");
        }
    };

    useEffect(() => {
        onInit();
    }, []);

    useEffect(() => {
        if (installing) {
            updateProgress(); // start the loop when installing is true
        }
    }, [installing]);
    const uninstall = async () => {
        try {
            await executeAction<ExecuteGetGameDetailsArgs, ContentType>(
                serverAPI,
                initActionSet,
                "Uninstall",
                {
                    shortname: shortname
                }
            );
            SteamClient.Apps.RemoveShortcut(parseInt(steamClientID));
            setSteamClientID("");
        } catch (error) {
            logger.error(error);
        }
    };
    const download = async (update: boolean) => {
        try {

            const result = await executeAction<ExecuteGetGameDetailsArgs, ContentType>(
                serverAPI,
                initActionSet,
                update ? "Update" : "Download",
                {
                    shortname: shortname
                }
            );
            if (result?.Type == "Progress") {
                setInstalling(true);
            }
        } catch (error) {
            logger.error(error);
        }
    };

    const onExeExit = () => {
        Navigation.CloseSideMenus();
        Navigation.Navigate(originRoute);
        const modal = showModal(<GameDetailsItem shortname={shortname} initActionSet={initActionSet} serverAPI={serverAPI} closeModal={() => modal.Close()} />);
    };

    const runScript = async (actionSet: string, actionId: string, args: any) => {
        const result = await executeAction<ExecuteGetGameDetailsArgs, ContentType>(serverAPI, actionSet, actionId, args, onExeExit);

        if (result?.Type == "Progress") {
            setInstalling(true);
        }

    };
    const cancelInstall = async () => {
        try {
            setInstalling(false);
            await executeAction(
                serverAPI,
                initActionSet,
                "CancelInstall",
                {
                    shortname: shortname
                }
            );

        } catch (error) {
            logger.error(error);
        }
    };

    const checkid = async () => {
        let id = parseInt(steamClientID);
        logger.debug("checkid", id);
        const apps = appStore.allApps.filter(app => app.appid == id);
        if (apps.length == 0) {
            return await getSteamId();
        } else {
            return id;
        }
    };

    const resetLaunchOptions = async () => {

        let id = await checkid();
        logger.debug("resetLaunchOptions id:", id);
        configureShortcut(id);

    };
    const configureShortcut = async (id: number) => {
        setSteamClientID(id.toString());
        const result = await executeAction<ExecuteInstallArgs, ContentType>(
            serverAPI,
            initActionSet,
            "Install",
            {
                shortname: shortname,
                steamClientID: id.toString()
            }
        );
        if (gameData.Type !== "GameDetails") {
            return;
        }
        const name = (gameData.Content as GameDetails).Name; //* this should be dealt with

        const apps = appStore.allApps.filter(app => app.display_name == name && app.app_type == 1073741824 && app.appid != id);
        for (const app of apps) {
            logger.debug("removing shortcut", app.appid);
            SteamClient.Apps.RemoveShortcut(app.appid);
        }
        cleanupIds();


        if (result == null) {
            logger.error("install result is null");
            return;
        }
        if (result.Type === "LaunchOptions") {
            const launchOptions = result.Content as LaunchOptions;
            //await SteamClient.Apps.SetAppLaunchOptions(gid, "");
            SteamClient.Apps.SetAppLaunchOptions(id, launchOptions.Options);
            SteamClient.Apps.SetShortcutName(id, (gameData.Content as GameDetails).Name);
            SteamClient.Apps.SetShortcutExe(id, launchOptions.Exe);
            SteamClient.Apps.SetShortcutStartDir(id, launchOptions.WorkingDir);
            const defaultProton = settingsStore.settings.strCompatTool;
            if (launchOptions.Compatibility && launchOptions.Compatibility == true) {
                logger.debug("Setting compatibility", launchOptions.CompatToolName);
                if (defaultProton) {
                    SteamClient.Apps.SpecifyCompatTool(id, defaultProton);
                }
            }
            else {
                logger.debug("Setting compatibility to empty string");
                SteamClient.Apps.SpecifyCompatTool(id, "");
            }
            setInstalling(false);
            serverAPI.toaster.toast({
                title: "Junk-Store",   
                body: "Launch options set",
            });

        }
        const imageResult = await executeAction<ExecuteGetGameDetailsArgs, GameImages>(
            serverAPI,
            initActionSet,
            "GetJsonImages",
            {
                shortname: shortname
            }
        );
        if (imageResult == null) {
            return;
        }
        const images = imageResult.Content;
        logger.debug("images", images);
        if (images.Grid !== null) {
            SteamClient.Apps.SetCustomArtworkForApp(id, images.Grid, 'png', 0);
        }
        if (images.Hero !== null) {
            SteamClient.Apps.SetCustomArtworkForApp(id, images.Hero, "png", 1);
        }
        if (images.Logo !== null) {
            SteamClient.Apps.SetCustomArtworkForApp(id, images.Logo, "png", 2);
        }
        if (images.GridH !== null) {
            SteamClient.Apps.SetCustomArtworkForApp(id, images.GridH, "png", 3);
        }


    };

    const cleanupIds = () => {
        //* wait what? why is this removing all shortcuts with empty display_name?
        const apps = appStore.allApps.filter(app => (app.display_name == "bash" || app.display_name == "") && app.app_type == 1073741824);
        for (const app of apps) {
            SteamClient.Apps.RemoveShortcut(app.appid);
        }
    };

    const getSteamId = async () => {

        const name = (gameData.Content as GameDetails).Name;
        const apps = appStore.allApps.filter(app => app.display_name == name && app.app_type == 1073741824);
        cleanupIds();
        if (apps.length > 0) {
            const id = apps[0].appid;
            if (apps.length > 1) {
                for (let i = 1; i < apps.length; i++) {
                    SteamClient.Apps.RemoveShortcut(apps[i].appid);
                }
            }
            return id;

        }
        else {
            const id = await SteamClient.Apps.AddShortcut("Name", "/bin/bash", "", "");
            if (gameData.Type !== "GameDetails") {
                return id;
            }
            SteamClient.Apps.SetShortcutName(id, (gameData.Content as GameDetails).Name);
            return id;
        }
    };
    const install = async () => {
        try {
            const id = await getSteamId();
            configureShortcut(id);

        } catch (error) {
            logger.error(error);
        }
    };

    return (
        <div className={gameDetailsRootClass}>
            <style>
                {`
                .${gameDetailsRootClass} .GenericConfirmDialog {
                    width: 100%;
                    height: 100%;
                    padding: 0;
                    border: 0;
                    border-radius: 0;
                    background: #0e172175;
                    backdrop-filter: blur(8px);
                }
                .${gameDetailsRootClass} .${gamepadDialogClasses.ModalPosition} {
                    padding: 0;
                }
                .${footerClasses.BasicFooter} {
                    border-top: unset;
                }
            `}
            </style>
            <ModalRoot onCancel={closeModal}>
                <Focusable
                    style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
                    onCancelActionDescription="Go back to Store"
                >
                    {gameData.Type === "Empty" && <Loading />}
                    {gameData.Type === "GameDetails" &&
                        <GameDisplay
                            serverApi={serverAPI}
                            name={(gameData.Content as GameDetails).Name}
                            shortName={(gameData.Content as GameDetails).ShortName}
                            description={(gameData.Content as GameDetails).Description}
                            images={(gameData.Content as GameDetails).Images}
                            steamClientID={steamClientID}
                            closeModal={closeModal}
                            installing={installing}
                            installer={() => download(false)}
                            progress={progress}
                            cancelInstall={cancelInstall}
                            uninstaller={uninstall}
                            editors={(gameData.Content as GameDetails).Editors}
                            initActionSet={initActionSet}
                            runner={() => runApp(parseInt(steamClientID), onExeExit)}
                            actions={scriptActions}
                            resetLaunchOptions={resetLaunchOptions}
                            updater={() => download(true)}
                            scriptRunner={runScript}
                            reloadData={reloadData}
                            onExeExit={onExeExit}
                        />
                    }
                </Focusable>
            </ModalRoot >
        </div>
    );
};
