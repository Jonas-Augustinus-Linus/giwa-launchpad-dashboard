# GIWA · RH Launch Workbench

운영 사이트: <https://jonas-augustinus-linus.github.io/giwa-launchpad-dashboard/>

첫 화면에서 프로젝트 저장, 준비물·예산 관리, 실제 Solidity 컴파일, 소스·ABI·바이트코드
다운로드, 론칭 패키지 생성, Pons V2 지갑 론칭·LP 마무리, 출처가 있는 관찰 기록을 진행합니다.
상황판·론칭 조사·리서치·노드·스왑풀·수익모델·개발상태도 기존 주소에 연결되어 있습니다.

설치나 로컬 서버 없이 브라우저에서 작동합니다. 첫 컴파일 때 같은 사이트에서 solc
0.8.30(약 9.6MB)을 가져와 Web Worker 안에서 실제로 컴파일합니다. 프로젝트 입력은
컴파일 서버로 보내지 않습니다. 공식 GIWA Sepolia/RH RPC로 조건을 조회·시뮬레이션하며 실행 시에는 사용자가 선택한 지갑이 트랜잭션을 처리합니다. Pons 메타데이터는 온체인에 공개됩니다.

초안·예산·관찰 기록은 각 브라우저에 저장됩니다. 다른 기기에서는 프로젝트 JSON을
내보내고 가져오세요. 사이트는 공개이며 공동 편집·로그인 기반 동기화는 제공하지 않습니다.
개인키나 계정 비밀을 입력하는 기능은 없습니다.

Pons는 토큰·거래 커브와 선택 초기 매수를, 직접 ERC-20 배포는 10억 개 전량 지갑 수취를 지원합니다.
생성비·매수·가스와 졸업 LP를 구분하고 매번 사용자 지갑에서 서명합니다. 전송 결과가
불명확하면 자동 재전송하지 않습니다. 개발 검증은 로컬 EVM이며 자동 시장 수집은 미연결입니다.

원본은 `Jonas-Augustinus-Linus/giwa-launchpad`의 `workbench/public/`과 `scripts/`에서
관리하고 이 저장소에는 생성한 정적 페이지·컴파일러·허용한 자료만 게시합니다.
개별 프로젝트는 게시 입력에 포함되지 않습니다. `deployment.json`에서 게시 원본 리비전을
확인할 수 있습니다. 컴파일러와 라이브러리 라이선스는 `workbench/licenses/`에 있습니다.

원본 저장소에서 미리보기:

```sh
npm ci --prefix workbench --ignore-scripts
npm run build:pages --prefix workbench
python3 scripts/build_dashboard_catalog.py
python3 scripts/build_dashboard_pages.py
python3 scripts/build_dashboard_library.py
python3 -m http.server 4173 --bind 127.0.0.1 --directory dashboard
```

`research_session_allowlist`에 등록된 자료만 포함합니다. `robots.txt`와 `noindex`는
접근제어가 아니며, GitHub Pages에 게시된 프로그램과 자료는 인터넷 전체에 공개됩니다.
