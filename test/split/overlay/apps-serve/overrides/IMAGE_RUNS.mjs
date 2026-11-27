// override IMAGE_RUNS sha256:6b2b18682dd1621cd177a3e227f9b0957930111df4ad4961ff08f145b1214e49
// apps@1 Serving (kit-984): main's IMAGE_RUNS with the hub app and its shared code as files, in place
// of hub.html, and serveAppFiles beside the seam's two.
const IMAGE_RUNS = {
  // whole files, as globs relative to the kit repo: the hub app and the shared code it imports are
  // what the image serves (apps@1 Serving, kit-984), so a change to either is a minor
  files: ['cloud/**', 'apps/hub/**', 'apps/dashboard/src/shared/**', 'docs/devteam/process/operator.md'],
  // parts of this file, as fileParts names them
  script: 'docs/devteam/scripts/devteam.mjs',
  parts: [
    // the handlers the machineWide expression dispatches to
    'cmdHub', 'cmdMachine', 'cmdOperatorThread', 'cmdRecover', 'cmdBoxPins',
    // what they are built from that serves only the image: the hub
    'probeHello', 'HUB_BODY_MAX', 'hubTurnOk', 'HUB_ACTIONS', 'startHub', 'hubLogger', 'imageHub',
    // the seam the hub sends its page through, and asks before its 404 (page-seam@1, kit-983), and the
    // export reader its files come from
    'servePage', 'servePageAsset', 'serveAppFiles',
    // recover --machine (a project's own recover runs from that project's kit, never the image's;
    // its recoverOne is listed below as a crossing, since it writes supervisor-up.json)
    'siblingOf', 'isAdopted', 'machineProjects', 'projectKit', 'projectJson', 'kitHasRecover', 'notedPaneOf', 'tmuxName', 'readUpList', 'recoverMachine', 'LEGACY_RECOVER_MESSAGE', 'legacyRecover',
    // machine status, tell, alert, pane-state
    'PANE_DIALOG', 'PANE_LIMIT_LINE', 'plainText', 'paneState', 'machineUsage', 'machineSpeaker', 'machineAlert', 'TELL_ENTER_TRIES', 'enterLanded', 'TELL_PREFIX', 'machineTell',
    'notedIn', 'openQuestionsOf', 'machineQuestions', 'utcDay', 'lastReview', 'harvestOf', 'machineKnowledge', 'vParts', 'versionBefore', 'portAnswers', 'hubLine', 'boxStatusLine',
    'box-memory', 'box-health-contract', 'box-health-sampler', 'box-health-processes', 'box-health-disk', 'box-health-state', 'box-health-pool', 'box-health-claude', 'box-health-park', 'box-health-room', 'machineLine', 'statusLastFile', 'partlyHeld', 'SUPERVISOR_IDLE_MS', 'supervisorIdleMinutes', 'OPERATOR_PR_MARK', 'OPERATOR_PR_WAIT_MS', 'operatorPrsLine', 'machineStatus',
    // operator threads
    'OPERATOR_THREAD_ID', 'OPERATOR_SUBJECT_MAX', 'OPERATOR_STARTING_MS', 'box', 'gatewayProofProblem', 'proofBody', 'operatorSession', 'operatorDir', 'operatorThreadsFile', 'operatorId', 'OPERATOR_PARTS',
    'operatorSubjectProblem', 'operatorLines', 'operatorThreads', 'operatorAppend', 'operatorLocked', 'tmuxAsk', 'OPERATOR_PANE_FORMAT', 'OPERATOR_MARK', 'operatorPaneRows', 'operatorPanes',
    'operatorStartFile', 'operatorStartNote', 'operatorStarting', 'operatorNoted', 'isShellPane', 'operatorSeat', 'operatorState', 'OPERATOR_OPENING', 'operatorStart', 'typeLine', 'OPERATOR_HELD',
    'operatorHeld', 'deliverToOperator', 'operatorDataFrame', 'operatorThreadUsage',
    // the files their turns carry (kit-724): the naming rules and the quoting, the checks, and the hub's
    // routes (a dashboard's too, from the project's own kit)
    'UPLOAD_MAX', 'UPLOAD_TOTAL', 'UPLOAD_FREE', 'UPLOAD_KEEP_MS', 'UPLOAD_STALL_MS', 'UPLOAD_NAME', 'UPLOAD_PART', 'UPLOAD_FOLDER', 'safeUploadName', 'shellQuote', 'dropPaste',
    'uploadsOnBox', 'laptopUploadsDir', 'uploadsRoot', 'droppedFileProblem', 'FILES_MAX', 'FILES_PATH_MAX', 'attachedFiles', 'UPLOAD_IMAGES', 'uploadType', 'serveLaptopUpload',
    'UPLOAD_REQUEST_MS', 'UPLOAD_BODY_MS', 'uploadLimits', 'uploadRootOk', 'sweepLaptopUploads', 'uploadsReceiving', 'receiveLaptopUpload',
    // box-pins (installed runs in the image; verify, check and bump beside it)
    'firstVersion', 'BOX_TOOLS', 'BOX_ARCHES', 'pinForm', 'escapeRe', 'HOLD_LIKE', 'readPins', 'pinsFile', 'releaseFlag', 'pinsBase', 'timedOut', 'unreachable', 'upstreamJson', 'notRelease', 'latestOf', 'holdText',
    'checkPins', 'pinsCheckLine', 'assetSum', 'bumpPins', 'BOX_PINS_USAGE',
    // the guards that let the image's commands run outside a project: the machineWide expression,
    // and the DEVTEAM_RUN guard in realPathMade's part, which repeats that list (the helpers homeAt
    // also calls, KIT_VIEWS, kitsOwnRepoAt, projectIn and repoLinksIn, are shared, so not listed)
    'homeAt', 'realPathMade',
    // the project-side parts the image relies on (the crossings): the presses the gateway signs and
    // a dashboard verifies, and the operator's role guard
    'gatewaySigned', 'termSigned', 'dashboardProofProblem', 'paneSigned', 'ownerSettingSigned', 'paneProofProblem', 'ownerSettingProofProblem', 'OPERATOR_READS', 'OPERATOR_SUBCOMMANDED',
    // the dispatcher and the operator's role guard (region dispatch), and what they read: the command
    // and its arguments
    'dispatch', 'command', 'parseArgs',
    // what keeps a project's kit read-only for the operator: no facts saved, no usage cache written, no host claim at a prompt
    'factsSaveAtExit', 'usageCache', 'cmdPrompt',
    // what the boot script calls in a project's kit: settings --get tmux_session, and the run/supervisor-pane record it reads and removes
    // (its name, its writers, when it is written, and the mark beside it, which the image reads through markedPane)
    'cmdSettings', 'tmuxSession', 'supervisorPaneFile', 'supervisorPaneMark', 'recordSupervisorPane', 'rememberSupervisorPane', 'markUpgradedPane', 'markedPane',
    // run/supervisor-up.json, which the boot script reads ("up": false) to choose whom to restore, and its writers, recover's own included
    'SUPERVISOR_UP_FILE', 'writeSupervisorUp', 'noteSupervisorFromTick', 'noteSupervisorSelf', 'recoverOne',
    // the ~/.devteam/repos-<port> records a project's kit writes and recover --machine reads
    'registerOnMachine', 'machineRepoDir',
    // a dashboard leaves the machine's hub to the image (dashboardHub); the hub's port, which names the
    // repos records too, and the block of ports a project's dashboard binds in, which the hub scans
    'dashboardHub', 'HUB_PORT', 'PORT_BASE', 'PORT_RANGE',
    // the classifier itself, and the readers it is built from, so a change to the list is a minor
    'IMAGE_RUNS', 'imageChanges', 'parts', 'globs',
  ],
};