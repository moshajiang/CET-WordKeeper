# 自定义安装器扩展：安装时可选「创建桌面快捷方式」
#
# 背景：electron-builder 的辅助安装器（oneClick: false）默认**无条件**创建桌面快捷方式
#（installSection.nsh 里 addDesktopLink 先于 customInstall 执行，且没有现成的勾选框 UI）。
# 做法：在「选择安装目录」之后插入一个勾选页（customPageAfterChangeDir 钩子），
#       取消勾选时在 customInstall（晚于 addDesktopLink）里删掉刚创建的快捷方式。
#
# ⚠️ 本文件被前置 include（早于模板里的 MUI2.nsh），所以：
#   1) 页面函数必须放进 customPageAfterChangeDir 宏内——该宏在 MUI2 之后才展开，
#      届时 MUI_HEADER_TEXT 可用，且 nsDialogs.nsh 自带的 LogicLib/WinMessages 也可用；
#   2) 这里只能有 Var / !define / !macro，不能直接写依赖 MUI 的顶层代码。
#
# 静默安装（/S）会跳过所有页面，此时变量保持空串 → 不等于 "0" → 仍创建快捷方式（保持默认行为）。

!ifndef CET_CUSTOM_INSTALLER_INCLUDED
  !define CET_CUSTOM_INSTALLER_INCLUDED

  ; BST_CHECKED —— 自定义常量名，避免依赖头文件的包含顺序（值同 WinMessages.nsh 的 0x0001）
  !define CET_BST_CHECKED 0x0001

  !macro _cetEnsureNsDialogs
    !ifndef CET_NSDIALOGS_INCLUDED
      !define CET_NSDIALOGS_INCLUDED
      !include "nsDialogs.nsh"
    !endif
  !macroend

  !macro customPageAfterChangeDir
    !insertmacro _cetEnsureNsDialogs

    ; Var 放在宏内：卸载器脚本也会 include 本文件但不展开此宏，
    ; 放外面会因「变量未使用」触发 makensis 的 warning 6001（被 electron-builder 当 error）
    Var hCetShortcutCheckbox
    ; "1" = 创建（默认）  "0" = 不创建
    Var cetDesktopShortcutWanted

    Function CreateDesktopShortcutPage
      !insertmacro MUI_HEADER_TEXT "附加任务" "选择安装时要执行的附加任务："
      nsDialogs::Create 1018
      Pop $0
      ${NSD_CreateCheckbox} 0u 6u 100% 13u "创建桌面快捷方式（取消勾选则不创建）"
      Pop $hCetShortcutCheckbox
      ${NSD_SetState} $hCetShortcutCheckbox ${CET_BST_CHECKED}
      StrCpy $cetDesktopShortcutWanted "1"
      nsDialogs::Show
    FunctionEnd

    Function LeaveDesktopShortcutPage
      ${NSD_GetState} $hCetShortcutCheckbox $0
      ${If} $0 == ${CET_BST_CHECKED}
        StrCpy $cetDesktopShortcutWanted "1"
      ${Else}
        StrCpy $cetDesktopShortcutWanted "0"
      ${EndIf}
    FunctionEnd

    Page custom CreateDesktopShortcutPage LeaveDesktopShortcutPage
  !macroend

  ; 在 addDesktopLink 之后执行：不想要就删掉刚创建的那一个（对旧升级安装无副作用）
  !macro customInstall
    ${If} $cetDesktopShortcutWanted == "0"
      DetailPrint "按您的选择：不创建桌面快捷方式"
      Delete "$newDesktopLink"
    ${EndIf}
  !macroend

!endif
