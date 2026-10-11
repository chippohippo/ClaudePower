@echo off
rem AimForge launcher - runs the managed exe on the installed .NET 8 desktop runtime.
start "" dotnet "%~dp0out\AimForge.exe" %*
