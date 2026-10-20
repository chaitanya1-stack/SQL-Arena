"""Interactive setup; sends credentials through stdin, never command arguments."""
import getpass,json,subprocess,sys
email=input('Admin email: ').strip()
name=input('Display name: ').strip()
password=getpass.getpass('New admin password (14+ characters): ')
if password!=getpass.getpass('Confirm password: '):sys.exit('Passwords do not match.')
cmd=['docker','compose','exec','-T','api','npm','run','admin'] if '--docker' in sys.argv else ['npm','run','admin']
result=subprocess.run(cmd,input=json.dumps(dict(email=email,name=name,password=password)),text=True)
sys.exit(result.returncode)
